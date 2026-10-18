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
  const directory = join(import.meta.dirname, 'fixtures/out/module-source-conditionals');
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
const respond = async (body: unknown) => {
  await waitFor(() => expect(pending.length).toBeGreaterThan(0));
  pending.shift()!.resolve(Response.json(body));
};

// A signed-in header: the session is a module-level source shared by pages.
const SESSION = "import { $fetch } from '@memoized-dom/data'; export const me = $fetch<{ name: string } | null>('/me');";

it.each([
  ['ternary on the source', `{me === null ? <a>Sign in</a> : <><a>New</a><b>{me.name}</b></>}`],
  ['&& on the source', `{me !== null && <b>{me.name}</b>}{me === null && <a>Sign in</a>}`],
])('a module-level source chooses between JSX branches: %s', async (_name, header) => {
  await mount(_name.replace(/\W+/g, '-'), {
    './session.ts': SESSION,
    './App.tsx': `import { $track } from '@memoized-dom/data'; import { me } from './session';
      export function App() { return <main><button id="refresh" onClick={() => $track(me).refresh()} /><nav>${header}</nav></main>; }`,
  });
  expect(nav()).toBe('');
  await respond(null);
  await waitFor(() => expect(nav()).toBe('<a>Sign in</a>'));
  document.querySelector<HTMLButtonElement>('#refresh')!.click();
  await respond({ name: 'ada' });
  await waitFor(() => expect(nav()).toContain('<b>ada</b>'));
  expect(nav()).not.toContain('Sign in');
});

it('a condition that dereferences a loading module source waits instead of throwing', async () => {
  await mount('guarded-condition', {
    './session.ts': SESSION,
    './App.tsx': `import { me } from './session';
      export function App() { return <main><nav>{me !== null && me.name === 'ada' ? <b>owner</b> : <i>reader</i>}</nav></main>; }`,
  });
  expect(nav()).toBe('');
  await respond({ name: 'ada' });
  await waitFor(() => expect(nav()).toBe('<b>owner</b>'));
});

// Conduit's navbar: while `me` loads, the signed-in branch must not mount a
// child that reads `me` (on the server it then crashed once `me` was null).
it('a choice over a loading module source shows the pending policy, then the chosen branch', async () => {
  await mount('pending-choice', {
    './session.ts': SESSION,
    './App.tsx': `import { Group } from '@memoized-dom/data'; import { me } from './session';
      function Card({ user }: { user: { name: string } }) { return <b>{user.name}</b>; }
      export function App() { return <main><nav><Group pending={() => <i>…</i>}>
        {me === null ? <a>Sign in</a> : <Card user={me} />}</Group></nav></main>; }`,
  });
  expect(nav()).toBe('<i>…</i>');
  await respond(null);
  await waitFor(() => expect(nav()).toBe('<a>Sign in</a>'));
});

it.each([
  ['directly', `<Card user={me} />`],
  ['inside a branch', `{me === null ? <a>Sign in</a> : <Card user={me} />}`],
])('a module-level source passes to a component as a prop %s', async (name, header) => {
  await mount('prop-' + name.replace(/\W+/g, '-'), {
    './session.ts': SESSION,
    './App.tsx': `import { me } from './session';
      function Card({ user }: { user: { name: string } }) { return <b>{user.name}</b>; }
      export function App() { return <main><nav>${header}</nav></main>; }`,
  });
  await respond({ name: 'ada' });
  await waitFor(() => expect(nav()).toBe('<b>ada</b>'));
});

// A prop named like an imported module source is the prop, not that source.
it('a prop that shadows a module source name reads the value it was given', async () => {
  await mount('shadowed-prop', {
    './session.ts': SESSION,
    './App.tsx': `import { me } from './session';
      function Card({ me }: { me: { name: string } }) { return <b title={me.name}>{me.name}</b>; }
      export function App() { return <main><nav><Card me={{ name: 'grace' }} /></nav></main>; }`,
  });
  expect(nav()).toBe('<b title="grace">grace</b>');
});

// A server function, or any app helper returning a source, called at module
// scope: the description must call that factory, not treat it as `$fetch(url)`.
it('a module-level source made by a linked factory requests through that factory', async () => {
  await mount('linked-factory', {
    './api.ts': "import { $fetch } from '@memoized-dom/data'; export function loadMe() { return $fetch<{ name: string }>('/api/me'); }",
    './session.ts': "import { loadMe } from './api'; export const me = loadMe();",
    './App.tsx': `import { me } from './session';
      export function App() { return <main><nav><b>{me.name}</b></nav></main>; }`,
  });
  await waitFor(() => expect(pending.length).toBe(1));
  expect(pending[0]!.url).toContain('/api/me');
  await respond({ name: 'ada' });
  await waitFor(() => expect(nav()).toBe('<b>ada</b>'));
});

// <Author item={source} /> in one place and <Author item={row} /> in another.
it('a component prop planned as a source also accepts plain data from another caller', async () => {
  await mount('mixed-prop', {
    './App.tsx': `import { $fetch } from '@memoized-dom/data';
      function Author({ item }: { item: { name: string } }) { return <i>{item.name}</i>; }
      function Row({ item }: { item: { name: string } }) { return <Author item={item} />; }
      export function App() { const one = $fetch<{ name: string }>('/one'); const rows = [{ id: 1, name: 'row' }];
        return <main><nav><Author item={one} />{rows.map(row => <Row key={row.id} item={row} />)}</nav></main>; }`,
  });
  await respond({ name: 'src' });
  await waitFor(() => expect(nav()).toBe('<i>src</i><i>row</i>'));
});

it('a branch chosen by local state reads a module-level source', async () => {
  await mount('local-branch', {
    './session.ts': SESSION,
    './App.tsx': `import { me } from './session';
      export function App() { let open = true;
        return <main><button id="toggle" onClick={() => { open = !open; }} /><nav>{open ? <b>{me.name}</b> : <i>closed</i>}</nav></main>; }`,
  });
  await respond({ name: 'ada' });
  await waitFor(() => expect(nav()).toBe('<b>ada</b>'));
  document.querySelector<HTMLButtonElement>('#toggle')!.click();
  expect(nav()).toBe('<i>closed</i>');
});
