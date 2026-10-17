import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { waitFor, type FetchStub } from '../test-support/helpers';
import { compileModules } from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime, type DataRuntime } from '@memoized-dom/data';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

let runtime: DataRuntime | null = null;
let previous: DataRuntime | null = null;
let pending: Array<{ url: string; resolve(response: Response): void }> = [];

afterEach(() => {
  for (const id of _internals().registry.keys()) unregister(id);
  document.body.replaceChildren();
  resetAccessTable();
  resetScheduler();
  if (previous !== null) setActiveDataRuntime(previous);
  runtime?.clear();
  runtime = previous = null;
  pending = [];
});

/** Each app gets its own module ids, as separate applications would. */
async function mount(name: string, modules: Record<string, string>): Promise<void> {
  const prefix = `./${name}/`;
  const output = compileModules(Object.fromEntries(Object.entries(modules)
    .map(([id, source]) => [prefix + id.slice(2), source])), { runtimePath: '@memoized-dom/runtime/testing' });
  const directory = join(import.meta.dirname, 'fixtures/out/request-state-sites');
  for (const [file, code] of Object.entries(output)) {
    mkdirSync(join(directory, file, '..'), { recursive: true });
    writeFileSync(join(directory, file), code);
  }
  runtime = createDataRuntime({
    fetch: ((input: string | URL | Request) => new Promise<Response>(resolve => {
      pending.push({ url: String(input), resolve });
    })) as FetchStub,
  });
  previous = setActiveDataRuntime(runtime);
  const { App } = await import(pathToFileURL(join(directory, prefix, 'App.tsx')).href);
  setScheduler(run => run());
  document.body.append(App('App', null));
}

const out = () => document.querySelector('#out')!.textContent;
const respond = async (body: unknown) => {
  await waitFor(() => expect(pending.length).toBeGreaterThan(0));
  pending.shift()!.resolve(Response.json(body));
};

it.each([
  ['the same field in two places', "{r.pending?'P':'D'}{r.pending?'p':'d'}", 'Pp', 'Dd'],
  ['two different fields', "{r.pending?'P':'D'}{r.refreshing?'R':'-'}", 'P-', 'D-'],
  ['status beside a coerced field', "{r.status}:{String(r.pending)}", 'pending:true', 'success:false'],
])('updates a tracker read in several template sites (%s)', async (label, template, before, after) => {
  await mount(`sites-${label.replaceAll(' ', '-')}`, {
    './App.tsx': `export function App(){const s=$fetch<{n:string}>('/api/a');const r=$track(s);
      return <main><output id="out">${template}</output></main>;}`,
  });
  expect(out()).toBe(before);
  await respond({ n: 'x' });
  await waitFor(() => expect(out()).toBe(after));
});

it('updates a component that reads only a module-level tracker', async () => {
  await mount('module-tracker', {
    './source.ts': "export const s=$fetch<{n:string}>('/api/a');export const r=$track(s);",
    './App.tsx': "import {r} from './source';export function App(){return <main><output id=\"out\">{r.pending?'P':'D'}</output></main>;}",
  });
  expect(out()).toBe('P');
  await respond({ n: 'x' });
  await waitFor(() => expect(out()).toBe('D'));
});

it('passes row props to simple row components listed directly in a ternary branch', async () => {
  await mount('ternary-rows', {
    './Note.tsx': "export function Note({note}:{note:{text:string}}){return <i>{note.text}</i>;}",
    './App.tsx': `import {Note} from './Note';
      export function App(){const notes=$fetch<{id:number;text:string}[]>('/api/notes');const r=$track(notes);
      return <main><output id="out">{r.pending?'loading':notes.map(n=><Note key={n.id} note={n}/>)}</output></main>;}`,
  });
  expect(out()).toBe('loading');
  await respond([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]);
  await waitFor(() => expect(out()).toBe('ab'));
});
