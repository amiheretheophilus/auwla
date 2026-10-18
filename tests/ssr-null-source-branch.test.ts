import { expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModules } from '@memoized-dom/compiler';
import { render } from '@memoized-dom/server';
import type { FetchStub } from '../test-support/helpers';

// Conduit's navbar: a signed-out visitor's `me` is null, and the branch that
// passes `me` to a child only renders when someone is signed in. Compiled as
// the server build compiles it: module state lives in per-request cells.
const AVATAR = 'export function Avatar({ profile, size }: { profile: { image: string }; size: number }) { return <img class="avatar" src={profile.image} alt="" width={size} height={size} />; }';
const NAV = `<nav>{me === null ? (<><a href="/login">Sign in</a><a href="/register">Sign up</a></>) : (<><a href="/editor">New</a><a class="me" title={me.username}><Avatar profile={me} size={22} /> {me.username}</a></>)}</nav>`;
const SESSIONS = {
  fetch: "import { $fetch } from '@memoized-dom/data'; export const me = $fetch<{ image: string } | null>('/api/me');",
  factory: "import { getMe } from './api'; export const me = getMe();",
};
const APPS = {
  plain: `import { me } from './session'; import { Avatar } from './components'; export function Main() { return ${NAV}; }`,
  'also a row': `import { me } from './session'; import { Avatar } from './components';
    export function Main() { const people = [{ image: '/x.png' }];
      return <main>${NAV}<ul>{people.map(person => <li key={person.image}><Avatar profile={person} /></li>)}</ul></main>; }`,
};

const cases = Object.entries(SESSIONS).flatMap(([session, sessionSource]) =>
  Object.entries(APPS).flatMap(([app, appSource]) => [
    [`${session}, ${app}, signed out`, sessionSource, appSource, null, 'Sign in</a>'],
    [`${session}, ${app}, signed in`, sessionSource, appSource, { image: '/ada.png', username: 'ada' }, 'src="/ada.png"'],
  ] as const));

it.each(cases)('a server render picks the branch for the loaded value (%s)', async (name, session, app, body, expected) => {
  const output = compileModules({
    './session.ts': session,
    './components.tsx': AVATAR,
    './api.ts': "import { $fetch } from '@memoized-dom/data'; export function getMe() { return $fetch<{ image: string } | null>('/api/me'); }",
    './app.tsx': app,
    './main.ts': "import { mount } from '@memoized-dom/runtime'; import { Main } from './app'; mount('root', Main);",
  }, { moduleStateCells: true, routedEnvironment: 'server' });
  const directory = join(import.meta.dirname, 'fixtures/out/ssr-null-source-branch', name.replace(/\W+/g, '-'));
  for (const [file, code] of Object.entries(output)) {
    mkdirSync(join(directory, file, '..'), { recursive: true });
    writeFileSync(join(directory, file), code);
  }
  const { Main } = await import(pathToFileURL(join(directory, 'app.tsx')).href);
  const fetch = (() => Promise.resolve(Response.json(body))) as FetchStub;
  const { html } = await render(Main, { mode: 'resolve', fetch });
  expect(html).toContain(expected);
});
