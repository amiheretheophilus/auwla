/**
 * The directory app (the test's copy, `fixtures/apps/directory`): an app rendered on the server, written in `.auwla`
 * down to its server functions and server-only module, built by compiler-next's own Bun plugin with
 * `auwla` as a source language.
 *
 * The server build is loaded with `import()` and asked for pages as a host would ask it. The client
 * build then starts on a page the server rendered, with `fetch` sent to that same server, so its
 * adoption of the server's markup, its server function calls and its server-backed `$routed`
 * requests all reach the real handlers.
 */
import { afterAll, afterEach, beforeAll, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { waitFor } from '../../../test-support/helpers';
// Compiler-next's Bun plugin has no package export yet; the tests read it as the CLI does.
import { memoizedDom } from '../../compiler-next/src/project/bun';
import { fileSystemHost } from '../../compiler-next/src/project';
import { createApplication } from '../../compiler-next/src/server/application';
import { checkoutPackagesFor } from '../tools/checkout';
import { auwla } from '../src';

const root = fileURLToPath(new URL('./fixtures/apps/directory/', import.meta.url));
const builds = mkdtempSync(join(import.meta.dir, '../.server-test-'));
afterAll(() => rmSync(builds, { recursive: true, force: true }));

const SERVER = { entry: './server.ts', folder: './server' };
/** The page around the app: the tool's delivery module gives it (`ServerIntegration`). */
const DELIVERY = `export default {
  document: () => '<!doctype html><html><head><title>Directory</title></head><body><div id="root"><!--ssr-outlet--></div></body></html>',
  assets: () => undefined,
};`;

interface Server {
  fetch(request: Request): Promise<Response>;
}
let server: Server;

beforeAll(async () => {
  const outdir = mkdtempSync(join(builds, 'server-'));
  const result = await Bun.build({
    entrypoints: [join(root, 'server.ts')],
    outdir,
    target: 'bun',
    plugins: [
      memoizedDom({ client: './src/main.ts', server: SERVER, target: 'server', delivery: DELIVERY, root, languages: [auwla] }),
      checkoutPackagesFor('server'),
    ],
  });
  if (!result.success) throw new AggregateError(result.logs, 'the directory server did not build');
  server = await withoutWindow(async () => (await import(pathToFileURL(join(outdir, 'server.js')).href)).default as Server);
});

/**
 * Runs server code as a server runs: with no `window`, `document` or `location`. The test preload
 * gives every file a browser window, and a render that sees one acts as the browser would (a data
 * request goes to `location`'s host over the network).
 */
async function withoutWindow<T>(run: () => Promise<T>): Promise<T> {
  await GlobalRegistrator.unregister();
  try {
    return await run();
  } finally {
    registerWindow();
  }
}

/** A page as the server renders it. */
async function page(path: string): Promise<string> {
  return withoutWindow(async () => {
    const response = await server.fetch(new Request(`http://localhost${path}`));
    expect(response.status).toBe(200);
    return response.text();
  });
}

/** The app's markup in a page: the server root, without the comments that mark its parts. */
function shown(html: string): string {
  const app = /<div id="root">([\s\S]*?)<script/.exec(html)![1]!;
  return app.replace(/<!--[\s\S]*?-->/g, '');
}

it('renders each route on the server, reading .auwla server functions and server-only code', async () => {
  // `listPeople()` comes from `#server-functions`; the server runs it and sends its result along.
  const home = await page('/');
  expect(shown(home)).toContain('<h1>Directory</h1>');
  expect(shown(home)).toContain('<a href="/people/1">Ada</a>');
  expect(shown(home)).toContain('<a href="/people/2">Lin</a>');
  expect(home).toContain('"name":"Lin"');

  // `$routed` reads `#server/people`, a `.auwla` module in the server folder, during the render.
  const person = await page('/people/2');
  expect(shown(person)).toContain('<h2>Lin</h2><p class="role">Designer</p>');
  expect(shown(person)).not.toContain('class="everyone"');
  expect(shown(await page('/people/9'))).toContain('No one with that id.');

  // The endpoints the browser calls, named after the `.auwla` module without its extension.
  const listed = await server.fetch(new Request('http://localhost/_fn/people/listPeople'));
  expect((await listed.json() as { name: string }[]).map((entry) => entry.name)).toEqual(['Ada', 'Lin']);
});

it('runs ordinary backend code written in .auwla (Hono, a Node built-in), compiled as plain code', async () => {
  const status = await withoutWindow(() => server.fetch(new Request('http://localhost/api/status')));
  expect(status.status).toBe(200);
  const body = await status.json() as { people: number; started: string; instance: string };
  expect(body.people).toBeGreaterThanOrEqual(2);
  expect(body.instance).toMatch(/^[0-9a-f-]{36}$/);

  // What compiler-next made of it: the authored code, with nothing of the runtime.
  const build = await createApplication({ client: './src/main.ts', server: SERVER, host: fileSystemHost(root), languages: [auwla] }).build();
  const code = build.server?.ok === true ? build.server.output['./server/status.auwla']! : '';
  expect(code).toContain("import { Hono } from 'hono';");
  expect(code).toContain("api.get('/status', (c) => c.json({ people: allPeople().length, started, instance }));");
  expect(code).not.toMatch(/_MD\.|_data\.|_read_|_mutated_/);
});

/** Requests the client sent to the server, by method and path. */
let requests: string[] = [];
const realFetch = globalThis.fetch;
let unmount: (() => void) | undefined;

afterEach(async () => {
  unmount?.();
  unmount = undefined;
  globalThis.fetch = realFetch;
  await freshPage();
});

/** A new window for the next app (see `routes.test.ts`). */
async function freshPage() {
  await GlobalRegistrator.unregister();
  registerWindow();
}

/** A browser window, keeping Bun's network and timers, as the preload does (`test-support/dom.ts`). */
function registerWindow() {
  const keep = ['fetch', 'Request', 'Response', 'Headers', 'AbortController', 'AbortSignal',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];
  const native = Object.fromEntries(keep.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)!]));
  GlobalRegistrator.register({ url: 'http://localhost:3000' });
  Object.defineProperties(globalThis, native);
}

async function buildClient(optimize: boolean): Promise<string> {
  const outdir = mkdtempSync(join(builds, optimize ? 'client-optimized-' : 'client-general-'));
  const result = await Bun.build({
    entrypoints: [join(root, 'src/main.ts')],
    target: 'browser',
    format: 'esm',
    outdir,
    naming: { entry: 'main.js' },
    plugins: [
      memoizedDom({ client: './src/main.ts', server: SERVER, root, optimize, languages: [auwla] }),
      checkoutPackagesFor('browser'),
    ],
  });
  if (!result.success) throw new AggregateError(result.logs, 'the directory client did not build');
  return join(outdir, 'main.js');
}

/** Starts the client on the page the server rendered for `path`. */
async function startOn(entry: string, path: string) {
  // Rendered first: the server runs with no window, and the page's window is made again after it.
  const html = await page(path);
  history.replaceState(null, '', path);
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1]!;
  const container = document.getElementById('root')!;
  // Every request goes to the server built above, as it would from the page it served.
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(new URL(input instanceof Request ? input.url : String(input), location.href), init);
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
    return server.fetch(request);
  }) as typeof fetch;
  const app = await import(`${pathToFileURL(entry).href}?start=${Date.now()}`) as { application: { unmount(): void } };
  unmount = () => app.application.unmount();
  return container;
}

const names = (container: Element) => [...container.querySelectorAll('.everyone li a')].map((link) => link.textContent);

for (const optimize of [true, false]) {
  const mode = optimize ? 'optimized' : 'general';

  it(`adopts the server's page and keeps working with the server in ${mode} mode`, async () => {
    const entry = await buildClient(optimize);
    const container = await startOn(entry, '/');
    const before = names(container);
    expect(before.slice(0, 2)).toEqual(['Ada', 'Lin']);
    const firstLink = container.querySelector('.everyone li a');

    // Adopted, not rendered again: the server's nodes stay, and the list came with the page (the
    // check after the click below also sees no late request for it).
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('.everyone li a')).toBe(firstLink);
    expect(requests).toEqual([]);

    // A link to a server-backed `$routed` page asks the server to prepare it.
    (container.querySelector('a[href="/people/2"]') as HTMLElement).click();
    await waitFor(() => expect(container.querySelector('.person h2')?.textContent).toBe('Lin'));
    expect(container.querySelector('.person .role')?.textContent).toBe('Designer');
    expect(requests).toEqual(['POST /_memoized/routed']);
    expect(container.querySelector('.everyone')).toBeNull();

    (container.querySelector('.person a') as HTMLElement).click();
    await waitFor(() => expect(names(container)).toEqual(before));

    // A form posting to a `.auwla` server function, then reading the list again.
    requests = [];
    const input = container.querySelector('input')!;
    input.value = `Grace ${mode}`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => expect(names(container)).toContain(`Grace ${mode}`));
    expect(requests).toEqual(['POST /_fn/people/createPerson', 'GET /_fn/people/listPeople']);
    expect(names(container)).toHaveLength(before.length + 1);
    expect(input.value).toBe('');
  });
}
