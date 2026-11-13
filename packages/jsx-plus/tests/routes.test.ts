/**
 * The team example (`examples/team`): routes, lazy route chunks, the data layer and effects, all
 * written in `.auwla`, built by compiler-next's own Bun plugin with `auwla` as a source language.
 *
 * Each build is written with chunk splitting to a temporary folder in this package and loaded with
 * `import()`, so a lazy page really is a separate module loaded on navigation, as in a browser.
 * `fetch` is replaced by a small in-memory API; the test then clicks, types and navigates.
 */
import { afterAll, afterEach, beforeEach, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { waitFor } from '../../../test-support/helpers';
// Compiler-next's Bun plugin has no package export yet; the tests read it as the CLI does.
import { memoizedDom } from '../../compiler-next/src/project/bun';
import { checkoutPackages } from '../examples/checkout';
import { auwla } from '../src';

const root = fileURLToPath(new URL('../examples/team/', import.meta.url));
const builds = mkdtempSync(join(import.meta.dir, '../.routes-test-'));
afterAll(() => rmSync(builds, { recursive: true, force: true }));

type Member = { id: number; name: string; role: string };
const MEMBERS: Member[] = [
  { id: 1, name: 'Ada Lovelace', role: 'Engineer' },
  { id: 2, name: 'Grace Hopper', role: 'Admiral' },
  { id: 3, name: 'Alan Turing', role: 'Researcher' },
];

/** The in-memory API: requests made, and failures to answer with. */
let requests: string[] = [];
let failNext = 0;
const realFetch = globalThis.fetch;
const realTitle = document.title;

beforeEach(() => {
  requests = [];
  failNext = 0;
  document.title = 'Team';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    requests.push(url.pathname + url.search);
    if (failNext > 0) {
      failNext--;
      return new Response('unavailable', { status: 503 });
    }
    const one = /^\/api\/people\/(\d+)$/.exec(url.pathname);
    if (one !== null) {
      const member = MEMBERS.find((entry) => entry.id === Number(one[1]));
      return member === undefined ? new Response('missing', { status: 404 }) : Response.json(member);
    }
    if (url.pathname === '/api/people') {
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      return Response.json(MEMBERS.filter((member) => member.name.toLowerCase().includes(search)));
    }
    return new Response('missing', { status: 404 });
  }) as typeof fetch;
});

let unmount: (() => void) | undefined;
afterEach(async () => {
  unmount?.();
  unmount = undefined;
  globalThis.fetch = realFetch;
  document.title = realTitle;
  await freshPage();
});

/**
 * A new window for the next app, as a browser gives each page load. Each build bundles its own
 * router, whose listeners stay on the window after its app unmounts; on a shared window the old
 * router would take the next app's link clicks first. Keeps Bun's network and timers, as the
 * preload does (`test-support/dom.ts`).
 */
async function freshPage() {
  const keep = ['fetch', 'Request', 'Response', 'Headers', 'AbortController', 'AbortSignal',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];
  const native = Object.fromEntries(keep.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)!]));
  await GlobalRegistrator.unregister();
  GlobalRegistrator.register({ url: 'http://localhost:3000' });
  Object.defineProperties(globalThis, native);
}

/** Builds the example into its own folder; returns the entry's path and every output's text. */
async function build(optimize: boolean) {
  const outdir = mkdtempSync(join(builds, optimize ? 'optimized-' : 'general-'));
  const result = await Bun.build({
    entrypoints: [join(root, 'main.ts')],
    target: 'browser',
    format: 'esm',
    splitting: true,
    outdir,
    naming: { entry: 'main.js', chunk: 'chunk-[hash].js' },
    plugins: [memoizedDom({ client: './main.ts', root, optimize, languages: [auwla] }), checkoutPackages],
  });
  if (!result.success) throw new AggregateError(result.logs, 'the team example did not build');
  const files = new Map<string, string>();
  for (const output of result.outputs) files.set(relative(outdir, output.path).replaceAll('\\', '/'), await output.text());
  return { entry: join(outdir, 'main.js'), files };
}

/** Starts a build at `url`: mounts it in `#app` and returns the entry's exports. */
async function start(entry: string, url: string) {
  history.replaceState(null, '', url);
  const container = document.createElement('div');
  container.id = 'app';
  document.body.append(container);
  // The module holding the route table waits for the first route's chunk and preparation.
  const app = await import(pathToFileURL(entry).href) as { application: { unmount(): void }; lifecycle: string[] };
  unmount = () => app.application.unmount();
  return { container, lifecycle: app.lifecycle };
}

const click = (container: Element, selector: string, text?: string) => {
  const found = [...container.querySelectorAll<HTMLElement>(selector)].find((node) => text === undefined || node.textContent === text);
  if (found === undefined) throw new Error(`nothing matches ${selector}${text === undefined ? '' : ` "${text}"`}`);
  found.click();
};
const names = (container: Element) => [...container.querySelectorAll('.people-list a')].map((link) => link.textContent);

it('splits each page into its own chunk, and keeps the local one in the entry', async () => {
  const { files } = await build(true);
  const entry = files.get('main.js')!;
  const chunks = [...files].filter(([name]) => name !== 'main.js').map(([, text]) => text);

  // The home section and the locally declared not-found page ship with the entry.
  expect(entry).toContain('Team directory');
  expect(entry).toContain('No page here.');
  // Each imported page is only in a chunk, loaded with its route.
  for (const text of ['Search people', 'Back to everyone', 'all written in .auwla']) {
    expect([text, entry.includes(text)]).toEqual([text, false]);
    expect([text, chunks.some((chunk) => chunk.includes(text))]).toEqual([text, true]);
  }
  expect(chunks.length).toBeGreaterThanOrEqual(3);
});

for (const optimize of [true, false]) {
  it(`navigates, loads data and runs effects in .auwla with optimize=${optimize}`, async () => {
    const { entry } = await build(optimize);
    const { container, lifecycle } = await start(entry, '/');
    expect(container.querySelector('.home h1')?.textContent).toBe('Team directory');
    expect(container.querySelector('.not-found')).toBeNull();
    expect(requests).toEqual([]);

    // The first request fails: `$track` shows the error, and Retry asks again.
    failNext = 1;
    click(container, 'nav a', 'People');
    await waitFor(() => expect(container.querySelector('.error')?.textContent).toContain('Could not load people.'));
    expect(location.pathname).toBe('/people');
    expect(container.querySelector('.directory h1')?.textContent).toBe('People');
    expect(container.querySelector('.home')).toBeNull();
    expect(lifecycle).toContain('people:shown');
    click(container, '.retry');
    await waitFor(() => expect(names(container)).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing']));
    expect(container.querySelector('.error')).toBeNull();
    expect(requests).toEqual(['/api/people?search=', '/api/people?search=']);

    // Typing changes the helper's argument, so the same binding requests again.
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = 'al';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => expect(names(container)).toEqual(['Alan Turing']));
    expect(requests.at(-1)).toBe('/api/people?search=al');

    // A parameter link: the person is prepared (`$routed`) before the page shows, its effect sets
    // the title, and the list page's effect cleans up as it leaves.
    click(container, '.people-list a', 'Alan Turing');
    await waitFor(() => expect(container.querySelector('.person h2')?.textContent).toBe('Alan Turing'));
    expect(location.pathname).toBe('/people/3');
    expect(container.querySelector('.person .role')?.textContent).toBe('Researcher');
    expect(container.querySelector('.directory h1')?.textContent).toBe('People');
    expect(requests).toContain('/api/people/3');
    await waitFor(() => expect(document.title).toBe('Alan Turing · Team'));
    expect(lifecycle).toContain('people:left');
    expect(lifecycle).toContain('person:3');

    // Back to the list: the person's cleanup restores the title.
    click(container, '.person a', 'Back to everyone');
    await waitFor(() => expect(names(container).length).toBeGreaterThan(0));
    await waitFor(() => expect(document.title).toBe('Team'));
    expect(lifecycle).toContain('person:3:left');

    // A lazy page with setup and `$cleanup`; leaving it runs the cleanup.
    click(container, 'nav a', 'About');
    await waitFor(() => expect(container.querySelector('.about h1')?.textContent).toBe('About'));
    expect(lifecycle).toContain('about:setup');
    expect(lifecycle).not.toContain('about:cleanup');
    click(container, 'nav a', 'Home');
    await waitFor(() => expect(container.querySelector('.home')).not.toBeNull());
    expect(lifecycle).toContain('about:cleanup');

    // An address no route declares shows the catch-all page.
    history.pushState(null, '', '/nowhere');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(container.querySelector('.not-found')?.textContent).toBe('No page here.'));
    expect(container.querySelector('.home')).toBeNull();
  }, 30_000);
}

it('opens a deep link: the lazy page and its preparation load before the app mounts', async () => {
  const { entry } = await build(true);
  const { container, lifecycle } = await start(entry, '/people/2');
  // Already there when `import()` returns: the entry waited for the chunk and the `$routed` data.
  expect(container.querySelector('.person h2')?.textContent).toBe('Grace Hopper');
  expect(requests).toEqual(['/api/people/2']);
  await waitFor(() => expect(document.title).toBe('Grace Hopper · Team'));
  expect(lifecycle).toEqual(['person:2']);
}, 30_000);
