/**
 * Server pages written in `.auwla` (`fixtures/apps/server-pages`): a server function module returns
 * markup with `page(...)`, built by compiler-next's Bun plugin with `auwla` as a source language
 * (`compiler-next/src/server/pages.ts`; `wiki/compiler/server.md`, "Server pages").
 *
 * The server build answers as a host would ask it. The client build then starts on the page the
 * server rendered, with `fetch` sent to that server: it binds the interactive board, keeps its
 * local state when the same page comes back with new inputs, and shows the passive page as HTML.
 */
import { afterAll, afterEach, beforeAll, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { waitFor } from '../../../test-support/helpers';
// Compiler-next's Bun plugin has no package export yet; the tests read it as the CLI does.
import { memoizedDom } from '../../compiler-next/src/project/bun';
import { decodePageHtml } from '../../runtime/src/page-html';
import { checkoutPackagesFor } from '../tools/checkout';
import { auwla } from '../src';

const root = fileURLToPath(new URL('./fixtures/apps/server-pages/', import.meta.url));
const builds = mkdtempSync(join(import.meta.dir, '../.server-pages-test-'));
afterAll(() => rmSync(builds, { recursive: true, force: true }));

const SERVER = { entry: './server.ts', folder: './server' };
const DELIVERY = `export default {
  document: () => '<!doctype html><html><head><title>Pages</title></head><body><div id="root"><!--ssr-outlet--></div></body></html>',
  assets: () => undefined,
};`;

interface Server {
  fetch(request: Request): Promise<Response>;
}
let server: Server;
let client: string;

beforeAll(async () => {
  const outdir = mkdtempSync(join(builds, 'server-'));
  const built = await Bun.build({
    entrypoints: [join(root, 'server.ts')],
    outdir,
    target: 'bun',
    plugins: [
      memoizedDom({ client: './src/main.ts', server: SERVER, target: 'server', delivery: DELIVERY, root, languages: [auwla] }),
      checkoutPackagesFor('server'),
    ],
  });
  if (!built.success) throw new AggregateError(built.logs, 'the server did not build');
  server = await withoutWindow(async () => (await import(pathToFileURL(join(outdir, 'server.js')).href)).default as Server);

  const clientOut = mkdtempSync(join(builds, 'client-'));
  const browser = await Bun.build({
    entrypoints: [join(root, 'src/main.ts')],
    target: 'browser',
    format: 'esm',
    outdir: clientOut,
    // `main.js`, and `main.css` for the styles the client's components bring.
    naming: { entry: '[name].[ext]' },
    plugins: [memoizedDom({ client: './src/main.ts', server: SERVER, root, languages: [auwla] }), checkoutPackagesFor('browser')],
  });
  if (!browser.success) throw new AggregateError(browser.logs, 'the client did not build');
  client = join(clientOut, 'main.js');
});

/** Runs server code with no `window`, as a server runs (see `server.test.ts`). */
async function withoutWindow<T>(run: () => Promise<T>): Promise<T> {
  await GlobalRegistrator.unregister();
  try {
    return await run();
  } finally {
    registerWindow();
  }
}

/** A browser window, keeping Bun's network and timers, as the preload does (`test-support/dom.ts`). */
function registerWindow() {
  const keep = ['fetch', 'Request', 'Response', 'Headers', 'AbortController', 'AbortSignal',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];
  const native = Object.fromEntries(keep.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)!]));
  GlobalRegistrator.register({ url: 'http://localhost:3000' });
  Object.defineProperties(globalThis, native);
}

async function ask(path: string, init?: RequestInit): Promise<Response> {
  return withoutWindow(() => server.fetch(new Request(`http://localhost${path}`, init)));
}

it('renders the .auwla page into the document, keeping unread fields off the wire', async () => {
  const html = await (await ask('/')).text();
  expect(html).toMatch(/<h1[^>]*>Ada<\/h1>/);
  expect(html).not.toContain('SERVER_SECRET');
  // The page's styles are in the document with it, for the first paint.
  expect(html).toMatch(/<style data-mmd-page-style>[^<]*border: 1px solid teal/);
  expect(html).not.toContain('Waiting for the server');
});

it('answers the page endpoints: the board with the inputs it reads, the denial page as HTML only', async () => {
  const board = await ask('/_fn/boards/getBoard', { headers: { 'x-mmd-stream': 'snapshot' } });
  const text = await board.text();
  expect(board.headers.get('x-mmd-page')).toBe('1');
  expect(text).not.toContain('SERVER_SECRET');
  const content = decodePageHtml(text) as { binding?: { inputs: unknown[] }; styles?: string[] };
  expect(content.binding?.inputs).toEqual([0, { name: 'Ada', hint: 'Event-only' }]);
  // Each page's CSS travels with its HTML: the board's component style.
  expect(content.styles?.join('\n')).toContain('border: 1px solid teal');

  const denied = decodePageHtml(await (await ask('/_fn/boards/getDenied', { headers: { 'x-mmd-stream': 'snapshot' } })).text()) as { html: string; binding?: unknown; styles?: string[] };
  expect(denied.html).toContain('denied');
  expect(denied.binding).toBeUndefined();
  // The server function module's own style, though the browser never gets its code.
  expect(denied.styles?.join('\n')).toContain('color: crimson');
  // The browser never gets the denial page's component (the app's own button says "Denied" too).
  expect(readFileSync(client, 'utf8')).not.toContain('"denied"');
});

let unmount: (() => void) | undefined;
const realFetch = globalThis.fetch;
afterEach(async () => {
  unmount?.();
  unmount = undefined;
  globalThis.fetch = realFetch;
  await GlobalRegistrator.unregister();
  registerWindow();
});

it('binds the board in the browser, and keeps its local state when the same page returns', async () => {
  const html = await (await ask('/')).text();
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1]!;
  // The page's source snapshot came with the document; later requests go to the server built above.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(new URL(input instanceof Request ? input.url : String(input), location.href), init);
    return server.fetch(request);
  }) as typeof fetch;
  const app = await import(`${pathToFileURL(client).href}?start=${Date.now()}`) as { application: { unmount(): void } };
  unmount = () => app.application.unmount();
  const container = document.getElementById('root')!;
  const query = (selector: string) => container.querySelector(selector) as HTMLElement | null;

  expect(query('h1')?.textContent).toBe('Ada');
  expect(query('.subtitle')?.textContent).toBe('No subtitle');
  query('.reveal')!.click();
  await waitFor(() => expect(query('.hint')?.textContent).toBe('Event-only'));
  query('.toggle')!.click();
  await waitFor(() => expect(query('.expanded')).not.toBeNull());

  // The POST's page is another call site: it replaces the GET's, and is bound in its turn.
  query('.save')!.click();
  await waitFor(() => expect(query('.count')?.textContent).toBe('1'), 5_000);
  expect(query('h1')?.textContent).toBe('Saved');
  query('.toggle')!.click();
  await waitFor(() => expect(query('.expanded')).not.toBeNull());

  // The same call site again: the bound board updates in place, keeping its state and nodes.
  const board = query('.board');
  query('.save')!.click();
  await waitFor(() => expect(query('.count')?.textContent).toBe('2'), 5_000);
  expect(query('.expanded')).not.toBeNull();
  expect(query('.board')).toBe(board);

  // A different page replaces it.
  query('.deny')!.click();
  await waitFor(() => expect(query('.denied')).not.toBeNull(), 5_000);
  expect(query('.board')).toBeNull();
});
