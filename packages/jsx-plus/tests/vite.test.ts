/**
 * The notes example through compiler-next's Vite plugin (`packages/vite/src/next/plugin.ts`), with
 * JSX+ only as a source language: a production build, and a dev server that compiles a `.auwla`
 * module, maps it, and hot-updates it on an edit. The example is copied into a temporary folder in
 * this package, so edits never touch it and the build finds the workspace's packages.
 */
import { afterAll, afterEach, expect, it, vi } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, createBuilder, createServer, type Rolldown, type ViteDevServer } from 'vite';
import { waitFor } from '../../../test-support/helpers';
// The package export is the built `dist`; Vite's own tests read the source the same way.
import memoizedDom from '../../vite/src';
import { createDevServer, type NativeDevServer } from '../../vite/src/dev';
import { auwla } from '../src';

const copies: string[] = [];
afterAll(() => {
  for (const copy of copies) rmSync(copy, { recursive: true, force: true });
});

/** A copy of the test's own app `fixtures/apps/<name>` in a temporary folder of this package. */
function copyExample(name: string): string {
  const copy = mkdtempSync(join(import.meta.dir, `../.vite-test-${name}-`));
  copies.push(copy);
  cpSync(fileURLToPath(new URL(`./fixtures/apps/${name}/`, import.meta.url)), copy, { recursive: true });
  // Its editor config extends a sibling folder the copy does not have; Vite would read it.
  rmSync(join(copy, 'tsconfig.json'));
  return copy;
}

const root = copyExample('notes');

let server: ViteDevServer | undefined;
let nativeServer: NativeDevServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  await nativeServer?.close();
  nativeServer = undefined;
});

const config = {
  root,
  configFile: false as const,
  logLevel: 'silent' as const,
  plugins: [memoizedDom({ clientEntry: 'main.ts', compiler: 'next', languages: [auwla] })],
};

it('builds the app with Vite, every .auwla module compiled', async () => {
  const result = await build({ ...config, build: { write: false } });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const chunks = outputs.flatMap((output) => output.output).filter((item): item is Rolldown.OutputChunk => item.type === 'chunk');
  const code = chunks.map((chunk) => chunk.code).join('\n');
  // Text from each component, and no JSX left: compiler-next compiled all three.
  expect(code).toContain('No notes yet.');
  expect(code).toContain('Write a note');
  expect(code).toContain('Notes');
  expect(code).not.toContain('<form');
  expect(code).not.toContain('jsx(');
}, 60_000);

it('splits each routed .auwla page into its own chunk in a Vite build', async () => {
  const team = copyExample('team');
  const result = await build({ ...config, root: team, build: { write: false } });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const chunks = outputs.flatMap((output) => output.output).filter((item): item is Rolldown.OutputChunk => item.type === 'chunk');
  const entry = chunks.find((chunk) => chunk.isEntry)!;

  // The home section and the locally declared not-found page ship with the entry.
  expect(entry.code).toContain('Team directory');
  expect(entry.code).toContain('No page here.');
  // Each page imported only for its route is in a chunk of its own, which the entry imports lazily.
  for (const text of ['Search people', 'Back to everyone', 'all written in .auwla']) {
    expect([text, entry.code.includes(text)]).toEqual([text, false]);
    const page = chunks.find((chunk) => !chunk.isEntry && chunk.code.includes(text));
    expect([text, page !== undefined]).toEqual([text, true]);
    expect(entry.dynamicImports).toContain(page!.fileName);
  }
}, 60_000);

it('compiles a .auwla module in dev, maps it, and hot-updates it on an edit', async () => {
  server = await createServer({ ...config, server: { middlewareMode: true } });
  const client = server.environments.client;
  const transformed = await client.transformRequest('/components/NoteList.auwla');
  expect(transformed?.code).toContain('import.meta.hot.accept');
  expect(transformed?.code).not.toContain('<li');
  const map = transformed?.map as { sources?: string[] } | null | undefined;
  expect(map?.sources?.some((source) => source.endsWith('NoteList.auwla'))).toBe(true);

  for (const path of ['/main.ts', '/App.auwla', '/NoteForm.auwla', '/components/index.ts', '/notes.ts']) {
    await client.transformRequest(path);
  }
  const send = vi.spyOn(client.hot, 'send').mockImplementation(() => {});
  type Payload = { type: string; updates?: { acceptedPath: string }[] };
  const payloads = () => send.mock.calls.map(([payload]) => payload as unknown as Payload);
  const accepted = () => payloads().flatMap((payload) => payload.updates ?? []).map((update) => update.acceptedPath);

  // A component module accepts its own update, as a `.tsx` one does.
  const file = join(root, 'components/NoteList.auwla');
  writeFileSync(file, readFileSync(file, 'utf8').replace('"No notes yet."', '"Nothing saved yet."'));
  await waitFor(() => expect(accepted()).toContain('/components/NoteList.auwla'), { timeout: 15_000 });
  expect(payloads().some((payload) => payload.type === 'full-reload')).toBe(false);
}, 60_000);

/**
 * Runs server code with no browser window, as a server runs (see `server.test.ts`): the preload's
 * window would make a server render act as the browser and request data over the network.
 */
async function withoutWindow<T>(run: () => Promise<T>): Promise<T> {
  const keep = ['fetch', 'Request', 'Response', 'Headers', 'AbortController', 'AbortSignal',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];
  await GlobalRegistrator.unregister();
  try {
    return await run();
  } finally {
    const native = Object.fromEntries(keep.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)!]));
    GlobalRegistrator.register({ url: 'http://localhost:3000' });
    Object.defineProperties(globalThis, native);
  }
}

const directoryPlugins = () => [memoizedDom({
  clientEntry: 'src/main.ts', serverEntry: 'server.ts', server: 'server', compiler: 'next', languages: [auwla],
})];

it('builds the .auwla directory as a full-stack Vite app: rendered pages, prepared routes, server functions', async () => {
  const directory = copyExample('directory');
  await withoutWindow(async () => {
    const builder = await createBuilder({ root: directory, configFile: false, logLevel: 'silent', plugins: directoryPlugins() });
    await builder.buildApp();
    // TypeScript's types for `#server-functions`, from the `.auwla` server functions.
    expect(readFileSync(join(directory, '.memoized', 'server-functions.d.ts'), 'utf8')).toContain('people.auwla');

    const { default: host } = await import(pathToFileURL(join(directory, 'dist', 'server.js')).href) as {
      default: { fetch(request: Request): Promise<Response> };
    };
    const get = async (path: string) => (await host.fetch(new Request(`http://localhost${path}`))).text();
    const home = await get('/');
    expect(home).toMatch(/<a href="\/people\/2">(?:<!--[^>]*-->)*Lin<\/a>/);
    // The browser's bundle, from the built client, adopts the server's markup.
    const script = /<script[^>]+src="([^"]+)"/.exec(home)?.[1];
    expect(script).toBeDefined();
    const asset = await host.fetch(new Request(new URL(script!, 'http://localhost/')));
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('hydrat');
    // `$routed` reads `#server/people` (a `.auwla` server module) on the server.
    expect((await get('/people/2')).replace(/<!--[\s\S]*?-->/g, '')).toContain('<h2>Lin</h2><p class="role">Designer</p>');
    expect(JSON.parse(await get('/_fn/people/listPeople'))).toHaveLength(2);
  });
}, 120_000);

it('renders the .auwla directory in the Vite dev server, and renders an edit on the next request', async () => {
  const directory = copyExample('directory');
  await withoutWindow(async () => {
    nativeServer = await createDevServer({
      root: directory, configFile: false, logLevel: 'silent', plugins: directoryPlugins(),
      server: { host: '127.0.0.1', port: 0 },
    });
    const origin = nativeServer.origin;
    const shown = async (path: string) => (await (await fetch(`${origin}${path}`)).text()).replace(/<!--[\s\S]*?-->/g, '');
    expect(await shown('/')).toContain('<a href="/people/1">Ada</a>');
    expect(await shown('/people/2')).toContain('<h2>Lin</h2>');
    expect(await (await fetch(`${origin}/_fn/people/listPeople`)).json()).toHaveLength(2);

    // An edit to a `.auwla` page shows on the next request, as a `.tsx` edit does.
    const person = join(directory, 'src/Person.auwla');
    writeFileSync(person, readFileSync(person, 'utf8').replace('"Back to everyone"', '"Back to the directory"'));
    await waitFor(async () => expect(await shown('/people/2')).toContain('Back to the directory'), { timeout: 15_000 });
  });
}, 120_000);

it('reports a .auwla syntax error with its authored place in dev', async () => {
  server = await createServer({ ...config, server: { middlewareMode: true } });
  const client = server.environments.client;
  await client.transformRequest('/NoteForm.auwla');
  const send = vi.spyOn(client.hot, 'send').mockImplementation(() => {});

  const file = join(root, 'NoteForm.auwla');
  const good = readFileSync(file, 'utf8');
  // An unterminated quoted child on line 20.
  writeFileSync(file, good.replace('<button type="submit">"Add"</button>', '<button type="submit">"Add</button>'));
  type ErrorPayload = { type: string; err?: { message: string; id?: string; loc?: { line: number } } };
  await waitFor(() => {
    const error = send.mock.calls.map(([payload]) => payload as unknown as ErrorPayload).find((payload) => payload.type === 'error');
    expect(error?.err?.message).toContain('NoteForm.auwla');
    expect(error?.err?.loc?.line).toBe(20);
  }, { timeout: 15_000 });
  writeFileSync(file, good);
}, 30_000);
