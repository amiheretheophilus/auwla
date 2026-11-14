/**
 * The team app (the test's copy, `fixtures/apps/team`): routes, lazy route chunks, the data layer and effects, all
 * written in `.auwla`, built by compiler-next's own Bun plugin with `auwla` as a source language.
 *
 * Each build is written with chunk splitting to a temporary folder in this package and loaded with
 * `import()`, so a lazy page really is a separate module loaded on navigation, as in a browser.
 * `fetch` is replaced by a small in-memory API; the test then clicks, types and navigates.
 */
import { afterAll, afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { waitFor } from '../../../test-support/helpers';
// Compiler-next's Bun plugin has no package export yet; the tests read it as the CLI does.
import { memoizedDom } from '../../compiler-next/src/project/bun';
import { checkoutPackages } from '../tools/checkout';
import { auwla } from '../src';

const root = fileURLToPath(new URL('./fixtures/apps/team/', import.meta.url));
const builds = mkdtempSync(join(import.meta.dir, '../.routes-test-'));
afterAll(() => rmSync(builds, { recursive: true, force: true }));

type Member = { id: number; name: string; role: string };
const MEMBERS: Member[] = [
  { id: 1, name: 'Ada Lovelace', role: 'Engineer' },
  { id: 2, name: 'Grace Hopper', role: 'Admiral' },
  { id: 3, name: 'Alan Turing', role: 'Researcher' },
];

/** The in-memory API: requests made, failures to answer with, and responses held back. */
let requests: string[] = [];
let failNext = 0;
let held: Promise<void> | null = null;
const realFetch = globalThis.fetch;
const realTitle = document.title;

/** Holds every response until the returned function is called, to see what shows meanwhile. */
function hold(): () => void {
  let release!: () => void;
  held = new Promise((resolve) => { release = resolve; });
  return () => {
    held = null;
    release();
  };
}

beforeEach(() => {
  requests = [];
  failNext = 0;
  held = null;
  document.title = 'Team';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    requests.push(url.pathname + url.search);
    if (held !== null) await held;
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
  // The same window for every app, deliberately. Each build bundles its own router; unmounting an
  // app releases its router's window listeners (`whileApplicationMounted`), so the next app gets
  // its own link clicks. Before that, the old router took them first.
  document.body.replaceChildren();
});

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
/** The text of the shown card's header slot (`components/Card.auwla`). */
const header = (container: Element) => container.querySelector('main .card-header')?.textContent?.trim();

it('splits each page into its own chunk, and keeps the local one in the entry', async () => {
  const { files } = await build(true);
  const entry = files.get('main.js')!;
  const chunks = [...files].filter(([name]) => name !== 'main.js').map(([, text]) => text);

  // The home section and the locally declared not-found page ship with the entry.
  expect(entry).toContain('Team directory');
  expect(entry).toContain('No page here.');
  // The entry's static and lazy imports, by file name.
  const statics = [...entry.matchAll(/from\s*"\.\/([^"]+)"|import\s*"\.\/([^"]+)"/g)].map((match) => match[1] ?? match[2]!);
  const lazy = [...entry.matchAll(/import\("\.\/([^"]+)"\)/g)].map((match) => match[1]!);
  const fileWith = (text: string) => [...files].find(([name, code]) => name !== 'main.js' && code.includes(text))?.[0];

  // `Card` is used outside routes too, so it loads with the entry: Bun shares it in a chunk the
  // entry imports statically, since the lazy pages use it as well.
  expect(statics).toContain(fileWith('card-header')!);
  // Each imported page is only in a chunk the entry loads with `import()`, with its route.
  for (const text of ['Search people', 'Back to everyone', 'all written in .auwla']) {
    expect([text, entry.includes(text)]).toEqual([text, false]);
    const file = fileWith(text);
    expect([text, file !== undefined && lazy.includes(file) && !statics.includes(file)]).toEqual([text, true]);
  }
  expect(chunks.length).toBeGreaterThanOrEqual(3);
});

for (const optimize of [true, false]) {
  it(`navigates, loads data and runs effects in .auwla with optimize=${optimize}`, async () => {
    const { entry } = await build(optimize);
    const { container, lifecycle } = await start(entry, '/');
    // The home card fills the header slot; no `<slot>` element reaches the DOM.
    expect(header(container)).toBe('Team directory');
    expect(container.querySelector('.home .card-body')?.textContent).toBe('Pick a page above.');
    expect(container.querySelector('slot')).toBeNull();
    expect(container.querySelector('.not-found')).toBeNull();
    expect(requests).toEqual([]);

    // While the list loads, the app's Group shows its placeholder where the list is read.
    let release = hold();
    failNext = 1;
    click(container, 'nav a', 'People');
    await waitFor(() => expect(container.querySelector('.people .loading')?.textContent).toBe('Loading…'));
    expect(location.pathname).toBe('/people');
    expect(container.querySelector('.directory h1')?.textContent).toBe('People');
    expect(container.querySelector('.home')).toBeNull();
    expect(names(container)).toEqual([]);
    expect(lifecycle).toContain('people:shown');

    // It fails: the page's error-only Group shows its Failure component, whose retry asks again.
    release();
    await waitFor(() => expect(container.querySelector('.error')?.textContent).toContain('Could not load people:'));
    expect(container.querySelector('.people .loading')).toBeNull();
    click(container, '.retry');
    await waitFor(() => expect(names(container)).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing']));
    expect(container.querySelector('.error')).toBeNull();
    expect(requests).toEqual(['/api/people?search=', '/api/people?search=']);
    // Its effect ran once. It writes `lifecycle` through `note()`, which it never reads: the list
    // arriving updated the page, and an effect depending on what it only wrote re-ran then.
    expect(lifecycle).toEqual(['people:shown']);

    // Typing changes the helper's argument, so the same binding requests again. The old list
    // stays while `$track` reports the refresh.
    release = hold();
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = 'al';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => expect(container.querySelector('.refreshing')?.textContent).toBe('Updating…'));
    expect(names(container)).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing']);
    expect(container.querySelector('.people .loading')).toBeNull();
    release();
    await waitFor(() => expect(names(container)).toEqual(['Alan Turing']));
    await waitFor(() => expect(container.querySelector('.refreshing')).toBeNull());
    expect(requests.at(-1)).toBe('/api/people?search=al');

    // A parameter link: `$routed` prepares the person first, so the list stays until it arrives.
    release = hold();
    click(container, '.people-list a', 'Alan Turing');
    await waitFor(() => expect(requests).toContain('/api/people/3'));
    await Bun.sleep(50);
    expect(names(container)).toEqual(['Alan Turing']);
    expect(container.querySelector('.card-header h2')).toBeNull();
    release();
    // Then the card fills its slots, the title effect runs, and the list page's effect cleans up.
    await waitFor(() => expect(container.querySelector('.card-header h2')?.textContent).toBe('Alan Turing'));
    expect(location.pathname).toBe('/people/3');
    expect(container.querySelector('.card-body .role')?.textContent).toBe('Researcher');
    expect(container.querySelector('.card-actions a')?.textContent).toBe('Back to everyone');
    expect(container.querySelector('.directory h1')?.textContent).toBe('People');
    await waitFor(() => expect(document.title).toBe('Alan Turing · Team'));
    expect(lifecycle).toContain('people:left');
    expect(lifecycle).toContain('person:3');

    // Back to the list through the link in the actions slot: the cleanup restores the title.
    click(container, '.card-actions a', 'Back to everyone');
    await waitFor(() => expect(names(container).length).toBeGreaterThan(0));
    await waitFor(() => expect(document.title).toBe('Team'));
    expect(lifecycle).toContain('person:3:left');

    // A lazy page with setup and `$cleanup`; leaving it runs the cleanup.
    click(container, 'nav a', 'About');
    await waitFor(() => expect(header(container)).toBe('About'));
    expect(lifecycle).toContain('about:setup');
    expect(lifecycle).not.toContain('about:cleanup');
    click(container, 'nav a', 'Home');
    await waitFor(() => expect(container.querySelector('.home')).not.toBeNull());
    expect(lifecycle).toContain('about:cleanup');
    // Every visit ran its setup or effect exactly once, and its cleanup once on leaving.
    expect(lifecycle).toEqual([
      'people:shown', 'people:left', 'person:3', 'person:3:left',
      'people:shown', 'people:left', 'about:setup', 'about:cleanup',
    ]);

    // An address no route declares shows the catch-all page, whose card falls back to the
    // header slot's own content.
    history.pushState(null, '', '/nowhere');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(container.querySelector('.not-found')?.textContent).toBe('No page here.'));
    expect(header(container)).toBe('Team');
    expect(container.querySelector('.home')).toBeNull();
  }, 30_000);
}

it('opens a deep link: the lazy page and its preparation load before the app mounts', async () => {
  const { entry } = await build(true);
  const { container, lifecycle } = await start(entry, '/people/2');
  // Already there when `import()` returns: the entry waited for the chunk and the `$routed` data.
  expect(container.querySelector('.card-header h2')?.textContent).toBe('Grace Hopper');
  expect(requests).toEqual(['/api/people/2']);
  await waitFor(() => expect(document.title).toBe('Grace Hopper · Team'));
  expect(lifecycle).toEqual(['person:2']);
}, 30_000);
