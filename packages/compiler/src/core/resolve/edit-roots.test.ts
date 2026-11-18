/**
 * Edits are not reads, in the static inputs (`edit-roots.ts`): a module value built by a call
 * that only edits state is not built again when that state changes, and the edits that do read
 * stay reads.
 */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mount, setScheduler, type MountedApplication } from '@memoized-dom/runtime/testing';
import { compileModules } from '../../pipeline';

const OPTIONS = { runtimePath: '@memoized-dom/runtime/testing' } as const;

let sequence = 0;
const mounted: { app: MountedApplication; host: HTMLElement }[] = [];
afterEach(() => {
  for (const { app, host } of mounted.splice(0)) {
    app.unmount();
    host.remove();
  }
});

/** Compile, load and mount `./App.tsx`; returns its host. */
async function render(modules: Record<string, string>): Promise<HTMLElement> {
  const output = compileModules(modules, OPTIONS);
  const directory = join(import.meta.dirname, '../../../tests/out/edit-roots', `case-${sequence++}`);
  mkdirSync(directory, { recursive: true });
  for (const [path, code] of Object.entries(output)) writeFileSync(join(directory, path), code);
  const module = await import(pathToFileURL(join(directory, 'App.tsx')).href);
  const host = document.createElement('div');
  document.body.append(host);
  setScheduler((work) => work());
  mounted.push({ app: mount(host, module.App), host });
  return host;
}

/** A Jotai-shaped store whose atoms are made in a module-level Map (`edit`: how `atom` fills it). */
const store = (edit: string) => `
const values = new Map();
export function atom(initial) { const key = { initial }; ${edit}; return key; }
export function useAtom(key) {
  const set = (next) => values.set(key, typeof next === 'function' ? next(values.get(key)) : next);
  return [values.get(key), set];
}
export const countAtom = atom(0);
`;

const app = `import { countAtom, useAtom } from './lib';
function Reader() { const [n] = useAtom(countAtom); return <p data-reader>{n}</p>; }
export function App() {
  const [n, setN] = useAtom(countAtom);
  return <main><button onClick={() => setN((value) => value + 1)}>+</button><p data-app>{n}</p><Reader /></main>;
}`;

it('keeps a module value whose call only edits a Map: both components follow the store', async () => {
  const host = await render({ './App.tsx': app, './lib.ts': store('values.set(key, initial)') });
  for (let click = 0; click < 2; click++) {
    host.querySelector('button')!.click();
    await Promise.resolve();
  }
  // Before: every edit of `values` built `countAtom` again, a new key holding 0, so both showed 0.
  expect(host.querySelector('[data-app]')!.textContent).toBe('2');
  expect(host.querySelector('[data-reader]')!.textContent).toBe('2');
});

it('does not rebuild a module value when the state its call only edits changes', () => {
  const rebuilds = (lib: string) => /_from\d* !== _valuesVersion/.test(compileModules({ './App.tsx': app, './lib.ts': lib }, OPTIONS)['./lib.ts']!);
  // Edits: a Map or Set made here, an array method, a store and a delete.
  expect(rebuilds(store('values.set(key, initial)'))).toBe(false);
  expect(rebuilds(store('values.delete(key)'))).toBe(false);
  expect(rebuilds(store('values.clear()'))).toBe(false);
  expect(rebuilds(store('values.set(key, initial)').replace('new Map()', 'new Set()').replace('values.set(key, initial)', 'values.add(key)'))).toBe(false);
  expect(rebuilds(store('values.set(key, initial)').replace('new Map()', '[]').replace('values.set(key, initial)', 'values.push(key)'))).toBe(false);
  expect(rebuilds(store('values.set(key, initial)').replace('new Map()', '{}').replace('values.set(key, initial)', 'values.latest = key'))).toBe(false);
  expect(rebuilds(store('values.set(key, initial)').replace('new Map()', '{ latest: null }').replace('values.set(key, initial)', 'delete values.latest'))).toBe(false);
  // Reads stay reads: a field, a lookup, a Map method on what may not be a Map, a `Map` that is
  // not the global one, and a callback that could read anything.
  expect(rebuilds(store('values.set(key, initial)').replace('new Map()', '{ n: 0 }').replace('values.set(key, initial)', 'const seen = values.n'))).toBe(true);
  expect(rebuilds(store('values.set(key, initial)').replace('values.set(key, initial)', 'values.get(key)'))).toBe(true);
  expect(rebuilds(store('values.set(key, initial)').replace('const values = new Map()', 'const values = make()\nfunction make() { return new Map(); }'))).toBe(true);
  expect(rebuilds(`class Map { set() { return values.size; } }\n${store('values.set(key, initial)')}`)).toBe(true);
  expect(rebuilds(store('values.set(key, initial)').replace('new Map()', '[]').replace('values.set(key, initial)', 'values.sort((a, b) => a - b)'))).toBe(true);
});
