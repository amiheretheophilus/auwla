import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { waitFor, type FetchStub } from '../test-support/helpers';
import { compileModules } from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime, type DataRuntime } from '@memoized-dom/data';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

// Code in a component body that depends on a loading value waits for it,
// wherever the read sits: a state seed, a derivation, a condition, an effect.

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
  delete (globalThis as { readinessLog?: unknown }).readinessLog;
});

async function mount(name: string, modules: Record<string, string>): Promise<void> {
  const prefix = `./${name}/`;
  const output = compileModules(Object.fromEntries(Object.entries(modules)
    .map(([id, source]) => [prefix + id.slice(2), source])), { runtimePath: '@memoized-dom/runtime/testing' });
  const directory = join(import.meta.dirname, 'fixtures/out/body-readiness');
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

const main = () => document.querySelector('main')?.innerHTML.replace(/<!--[^>]*-->/g, '') ?? '';
const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
const respondTo = async (url: string, body: unknown) => {
  await waitFor(() => expect(pending.some(request => request.url.endsWith(url))).toBe(true));
  pending.splice(pending.findIndex(request => request.url.endsWith(url)), 1)[0]!.resolve(Response.json(body));
};

const SESSION = "import { $fetch } from '@memoized-dom/data'; export const me = $fetch<{ name: string } | null>('/api/me');";

it.each([
  ['a module source', SESSION, "import { me } from './session';", ''],
  ['a local source', null, '', "const me = $fetch<{ name: string } | null>('/api/me');"],
])('state seeded from %s starts once it loads, then is ordinary state', async (_name, session, imports, local) => {
  await mount('seed-' + (session === null ? 'local' : 'module'), {
    ...(session === null ? {} : { './session.ts': session }),
    './App.tsx': `import { $fetch } from '@memoized-dom/data'; ${imports}
      export function App() { ${local}
        let tab = me === null ? 'global' : 'feed';
        return <main><p id="tab">{tab}</p><button id="global" onClick={() => { tab = 'global'; }} /></main>; }`,
  });
  await respondTo('/api/me', { name: 'ada' });
  await waitFor(() => expect(document.querySelector('#tab')?.textContent).toBe('feed'));
  click('#global');
  expect(document.querySelector('#tab')?.textContent).toBe('global');
});

it('a derivation through plain code and helpers waits for its source', async () => {
  await mount('derived', {
    './App.tsx': `import { $fetch } from '@memoized-dom/data';
      function shout(text: string) { return text.toUpperCase() + '!'; }
      export function App() { const article = $fetch<{ title: string; tags: string[] }>('/api/article');
        const title = shout(article.title);
        const count = article.tags.length + ' tags';
        return <main><h1>{title}</h1><p>{count}</p></main>; }`,
  });
  await respondTo('/api/article', { title: 'hello', tags: ['a', 'b'] });
  await waitFor(() => expect(main()).toContain('<h1>HELLO!</h1>'));
  expect(main()).toContain('<p>2 tags</p>');
});

it('a component that returns early on a loading value waits for it', async () => {
  await mount('early-return', {
    './App.tsx': `import { $fetch } from '@memoized-dom/data';
      export function App() { const article = $fetch<{ title: string; hidden: boolean }>('/api/article');
        if (article.hidden) return <main><p>hidden</p></main>;
        return <main><h1>{article.title}</h1></main>; }`,
  });
  await respondTo('/api/article', { title: 'hello', hidden: false });
  await waitFor(() => expect(main()).toContain('<h1>hello</h1>'));
});

it('an effect that reads a loading value first runs with the loaded value', async () => {
  (globalThis as { readinessLog?: string[] }).readinessLog = [];
  await mount('effect', {
    './App.tsx': `import { $fetch } from '@memoized-dom/data';
      export function App() { const article = $fetch<{ title: string }>('/api/article');
        $effect(() => { (globalThis as any).readinessLog.push(article.title); });
        return <main><h1>{article.title}</h1></main>; }`,
  });
  await respondTo('/api/article', { title: 'hello' });
  await waitFor(() => expect(main()).toContain('<h1>hello</h1>'));
  expect((globalThis as { readinessLog?: string[] }).readinessLog).toEqual(['hello']);
});

it('a request built from a loading value waits for it', async () => {
  await mount('chained', {
    './App.tsx': `import { $fetch } from '@memoized-dom/data';
      export function App() { const article = $fetch<{ slug: string }>('/api/article');
        const comments = $fetch<string[]>('/api/comments/' + article.slug);
        return <main><ul>{comments.map(text => <li key={text}>{text}</li>)}</ul></main>; }`,
  });
  await respondTo('/api/article', { slug: 'hello' });
  await respondTo('/api/comments/hello', ['first']);
  await waitFor(() => expect(main()).toContain('<li>first</li>'));
  expect(pending.some(request => request.url.includes('undefined'))).toBe(false);
});

it('a request built by an app helper from a loading value waits for it', async () => {
  await mount('chained-helper', {
    './comments.ts': `import { $fetch } from '@memoized-dom/data';
      export function commentsFor(slug: string) { return $fetch<string[]>('/api/comments/' + slug); }`,
    './App.tsx': `import { $fetch } from '@memoized-dom/data'; import { commentsFor } from './comments';
      export function App() { const article = $fetch<{ slug: string }>('/api/article');
        const comments = commentsFor(article.slug);
        return <main><ul>{comments.map(text => <li key={text}>{text}</li>)}</ul></main>; }`,
  });
  await respondTo('/api/article', { slug: 'hello' });
  await respondTo('/api/comments/hello', ['first']);
  await waitFor(() => expect(main()).toContain('<li>first</li>'));
  expect(pending.some(request => request.url.includes('undefined'))).toBe(false);
});

it('an effect that reads a derivation of a loading value runs with the loaded value', async () => {
  (globalThis as { readinessLog?: string[] }).readinessLog = [];
  await mount('effect-derived', {
    './App.tsx': `import { $fetch } from '@memoized-dom/data';
      export function App() { const article = $fetch<{ title: string }>('/api/article');
        const title = article.title.toUpperCase();
        $effect(() => { (globalThis as any).readinessLog.push(title); });
        return <main><h1>{title}</h1></main>; }`,
  });
  await respondTo('/api/article', { title: 'hello' });
  await waitFor(() => expect(main()).toContain('<h1>HELLO</h1>'));
  expect((globalThis as { readinessLog?: string[] }).readinessLog).toEqual(['HELLO']);
});

it('a component that returns early on a module source waits for it', async () => {
  await mount('early-return-module', {
    './session.ts': SESSION,
    './App.tsx': `import { me } from './session';
      export function App() {
        if (me === null) return <main><p>signed out</p></main>;
        return <main><p>{me.name}</p></main>; }`,
  });
  expect(main()).not.toContain('signed out');
  await respondTo('/api/me', { name: 'ada' });
  await waitFor(() => expect(main()).toContain('<p>ada</p>'));
});

it('state seeded through a derivation starts once its source loads', async () => {
  await mount('seed-derived', {
    './App.tsx': `import { $fetch } from '@memoized-dom/data';
      export function App() { const article = $fetch<{ tags: string[] }>('/api/article');
        const tags = article.tags;
        let selected = tags[0];
        return <main><p id="selected">{selected}</p><button id="pick" onClick={() => { selected = tags[1]; }} /></main>; }`,
  });
  await respondTo('/api/article', { tags: ['a', 'b'] });
  await waitFor(() => expect(document.querySelector('#selected')?.textContent).toBe('a'));
  click('#pick');
  expect(document.querySelector('#selected')?.textContent).toBe('b');
});
