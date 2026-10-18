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
  const directory = join(import.meta.dirname, 'fixtures/out/loading-props');
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

const main = () => document.querySelector('main')!.innerHTML.replace(/<!--[^>]*-->/g, '');
const respondTo = async (url: string, body: unknown) => {
  await waitFor(() => expect(pending.some(request => request.url.endsWith(url))).toBe(true));
  pending.splice(pending.findIndex(request => request.url.endsWith(url)), 1)[0]!.resolve(Response.json(body));
};
const respond = async (body: unknown) => {
  await waitFor(() => expect(pending.length).toBeGreaterThan(0));
  pending.shift()!.resolve(Response.json(body));
};

// Conduit's article page: parts of a loading article passed to child components.
const CHILDREN = `
  function TagList({ tags }: { tags: string[] }) { return <ul>{tags.map(tag => <li key={tag}>{tag}</li>)}</ul>; }
  function Title({ text }: { text: string }) { return <h1>{text}</h1>; }`;

it.each([
  ['under a Group', '<Group pending={Loading}><Title text={article.title} /><TagList tags={article.tags} /></Group>'],
  ['under suspend', '<Group pending={Loading}><div suspend><Title text={article.title} /><TagList tags={article.tags} /></div></Group>'],
])('a child whose props read a loading source mounts once it commits (%s)', async (name, body) => {
  await mount('loading-' + name.replace(/\W+/g, '-'), {
    './App.tsx': `import { $fetch, Group } from '@memoized-dom/data'; ${CHILDREN}
      function Loading() { return <i>loading</i>; }
      export function App() { const article = $fetch<{ title: string; tags: string[] }>('/api/article');
        return <main>${body}</main>; }`,
  });
  expect(main()).not.toContain('<li>');
  await respond({ title: 'Hello', tags: ['a', 'b'] });
  await waitFor(() => expect(main()).toContain('<h1>Hello</h1>'));
  expect(main()).toContain('<ul><li>a</li><li>b</li></ul>');
  expect(main()).not.toContain('loading');
});

it('the same child also accepts plain data from another caller', async () => {
  await mount('loading-mixed', {
    './App.tsx': `import { $fetch } from '@memoized-dom/data'; ${CHILDREN}
      export function App() { const article = $fetch<{ title: string; tags: string[] }>('/api/article');
        return <main><TagList tags={['plain']} /><TagList tags={article.tags} /></main>; }`,
  });
  expect(main()).toContain('<li>plain</li>');
  await respond({ title: 'Hello', tags: ['loaded'] });
  await waitFor(() => expect(main()).toContain('<li>loaded</li>'));
  expect(main()).toContain('<li>plain</li>');
});


// Conduit's FollowButton: the child edits the object it was given.
it('a child edits the loaded object it received, and the parent sees it', async () => {
  await mount('loading-write', {
    './App.tsx': `import { $fetch } from '@memoized-dom/data';
      function Follow({ profile }: { profile: { name: string; following: boolean } }) {
        return <button id="follow" onClick={() => { profile.following = !profile.following; }}>{profile.following ? 'unfollow' : 'follow'} {profile.name}</button>;
      }
      export function App() { const article = $fetch<{ author: { name: string; following: boolean } }>('/api/article');
        return <main><Follow profile={article.author} /><p id="lead">{article.author.following ? 'yes' : 'no'}</p></main>; }`,
  });
  await respond({ author: { name: 'grace', following: false } });
  await waitFor(() => expect(document.querySelector('#follow')?.textContent).toBe('follow grace'));
  document.querySelector<HTMLButtonElement>('#follow')!.click();
  await waitFor(() => expect(document.querySelector('#follow')?.textContent).toBe('unfollow grace'));
  expect(document.querySelector('#lead')?.textContent).toBe('yes');
});

// Conduit's ArticleActions: the gated child sits inside a conditional branch.
it('a child reading a loading source inside a conditional branch', async () => {
  await mount('loading-branch', {
    './App.tsx': `import { $fetch } from '@memoized-dom/data';
      function Name({ text }: { text: string }) { return <b>{text}</b>; }
      export function App() { const article = $fetch<{ author: { name: string } }>('/api/article'); let own = false;
        return <main><button id="own" onClick={() => { own = !own; }} />
          {own ? <div><i>mine</i></div> : <div><Name text={article.author.name} /></div>}</main>; }`,
  });
  await respond({ author: { name: 'grace' } });
  await waitFor(() => expect(main()).toContain('<b>grace</b>'));
  document.querySelector<HTMLButtonElement>('#own')!.click();
  expect(main()).toContain('<i>mine</i>');
});

it('a child reading a source prop inside a returned conditional over a module source', async () => {
  await mount('loading-actions', {
    './session.ts': "import { $fetch } from '@memoized-dom/data'; export const me = $fetch<{ name: string } | null>('/api/me');",
    './App.tsx': `import { $fetch } from '@memoized-dom/data'; import { me } from './session';
      function Name({ text }: { text: string }) { return <b>{text}</b>; }
      function Actions({ article }: { article: { author: { name: string } } }) {
        return me !== null && me.name === article.author.name ? <div><i>edit</i></div> : <div><Name text={article.author.name} /></div>;
      }
      export function App() { const article = $fetch<{ author: { name: string } }>('/api/article'); return <main><Actions article={article} /></main>; }`,
  });
  await respondTo('/api/me', null);
  await respondTo('/api/article', { author: { name: 'grace' } });
  await waitFor(() => expect(main()).toContain('<b>grace</b>'));
});
