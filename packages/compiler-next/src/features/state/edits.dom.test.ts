/**
 * A component's statement that edits a module's state through a helper (`runtime/src/computation.ts`,
 * `settleEdits`): it follows that state when the edit was guarded and its value was read from the
 * state afterwards, and otherwise runs once, as JavaScript runs it.
 */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mount, setScheduler, type MountedApplication } from '@memoized-dom/runtime/testing';
import { compileModules } from '../../pipeline';

let sequence = 0;
const mounted: { app: MountedApplication; host: HTMLElement }[] = [];
afterEach(() => {
  for (const { app, host } of mounted.splice(0)) {
    app.unmount();
    host.remove();
  }
});

/** Compile, load and mount `./App.tsx`; returns its host and a click on its button. */
async function render(modules: Record<string, string>) {
  const output = compileModules(modules, { runtimePath: '@memoized-dom/runtime/testing' });
  const directory = join(import.meta.dirname, '../../../tests/out/state-edits', `case-${sequence++}`);
  mkdirSync(directory, { recursive: true });
  for (const [path, code] of Object.entries(output)) writeFileSync(join(directory, path), code);
  const module = await import(pathToFileURL(join(directory, 'App.tsx')).href);
  const host = document.createElement('div');
  document.body.append(host);
  setScheduler((work) => work());
  mounted.push({ app: mount(host, module.App), host });
  const shown = () => [...host.querySelectorAll('[data-n]')].map((node) => node.textContent).join(' ');
  const click = async () => {
    host.querySelector('button')!.click();
    await Promise.resolve();
  };
  return { shown, click, module };
}

/** Two components using `use(name)`, and a button calling `add('extra')`. */
const app = `import { use, add } from './lib';
function Reader() { const value = use('reader'); return <p data-n>{value}</p>; }
export function App() {
  const value = use('app');
  return <main><button onClick={() => add('extra')}>+</button><p data-n>{value}</p><Reader /></main>;
}`;

it('follows an array a statement registered in behind a guard, in both components', async () => {
  const { shown, click } = await render({ './App.tsx': app, './lib.ts': `
    const seen = [];
    export function use(name) { if (!seen.includes(name)) seen.push(name); return seen.length; }
    export function add(name) { seen.push(name); }
  ` });
  // Each registered its own name, and each follows the count: before, neither did.
  expect(shown()).toBe('2 2');
  await click();
  expect(shown()).toBe('3 3');
});

it('follows a Jotai-shaped store that fills its Map on first use, in the component that filled it', async () => {
  const { shown, click } = await render({
    './App.tsx': `import { countAtom, useAtom } from './lib';
      function Reader() { const [n] = useAtom(countAtom); return <p data-n>{n}</p>; }
      export function App() {
        const [n, setN] = useAtom(countAtom);
        return <main><button onClick={() => setN((value) => value + 1)}>+</button><p data-n>{n}</p><Reader /></main>;
      }`,
    './lib.ts': `
      const values = new Map();
      export function atom(initial) { return { initial }; }
      export function useAtom(key) {
        if (!values.has(key)) values.set(key, key.initial);
        const set = (next) => values.set(key, typeof next === 'function' ? next(values.get(key)) : next);
        return [values.get(key), set];
      }
      export const countAtom = atom(0);
    ` });
  await click();
  await click();
  expect(shown()).toBe('2 2');
});

it('runs an unguarded registration once per component, never again when anything else registers', async () => {
  const { shown, click, module } = await render({ './App.tsx': `${app}\nexport { names } from './lib';`, './lib.ts': `
    export const names = [];
    export function use(name) { names.push(name); return names.length; }
    export function add(name) { names.push(name); }
  ` });
  expect(shown()).toBe('1 2');
  await click();
  // Following it would push each name again on every edit, and two components would wake each other.
  expect(module.names).toEqual(['app', 'reader', 'extra']);
  expect(shown()).toBe('1 2');
});
