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

async function mount(name: string, modules: Record<string, string>): Promise<void> {
  const prefix = `./${name}/`;
  const output = compileModules(Object.fromEntries(Object.entries(modules)
    .map(([id, source]) => [prefix + id.slice(2), source])), { runtimePath: '@memoized-dom/runtime/testing' });
  const directory = join(import.meta.dirname, 'fixtures/out/source-choices');
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

const nav = () => document.querySelector('nav')!.innerHTML.replace(/<!--[^>]*-->/g, '');

const out = () => document.querySelector('#out')!.textContent;
const respond = async (url: string, body: unknown) => {
  await waitFor(() => expect(pending.some(request => request.url.endsWith(url)), `no request for ${url}`).toBe(true));
  const index = pending.findIndex(request => request.url.endsWith(url));
  pending.splice(index, 1)[0]!.resolve(Response.json(body));
};

// Conduit's profile tabs: one feed whose request depends on the tab.
it('a conditional choosing between two calls of one factory is one rebinding source', async () => {
  await mount('choice', {
    './App.tsx': `import { $fetch } from '@memoized-dom/data';
      export function App() { let favorites = false;
        const feed = favorites ? $fetch<{ title: string }>('/api/favorites') : $fetch<{ title: string }>('/api/mine');
        return <main><button id="tab" onClick={() => { favorites = !favorites; }} /><output id="out">{feed.title}</output></main>; }`,
  });
  await respond('/api/mine', { title: 'mine' });
  await waitFor(() => expect(out()).toBe('mine'));
  document.querySelector<HTMLButtonElement>('#tab')!.click();
  await respond('/api/favorites', { title: 'favorites' });
  await waitFor(() => expect(out()).toBe('favorites'));
});

it('rejects a conditional choosing between two different source factories', () => {
  expect(() => compileModules({
    './main.ts': "import { mount } from '@memoized-dom/runtime'; import { App } from './App'; mount('root', App);",
    './App.tsx': `import { $fetch, $read } from '@memoized-dom/data';
      export function App() { let live = false;
        const feed = live ? $fetch('/api/a') : $read(Promise.resolve(1), () => Promise.resolve(1));
        return <main><output>{String(feed)}</output></main>; }`,
  })).toThrow(/cannot choose between two data sources/);
});
