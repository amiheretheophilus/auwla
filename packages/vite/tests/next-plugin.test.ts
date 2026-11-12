/**
 * The Vite plugin over compiler-next's applications (`src/next/plugin.ts`): builds, dev transforms,
 * hot updates and errors, and a full-stack build serving its page and a server function.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { build, createBuilder, createServer, type ViteDevServer } from 'vite';
import { waitFor } from '../../../test-support/helpers';
import memoizedDom from '../src';
import { createDevServer, type NativeDevServer } from '../src/dev';

// Inside the package, so a build finds the workspace's packages as an app finds its own.
const root = mkdtempSync(join(import.meta.dir, '../.next-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let server: ViteDevServer | undefined;
let nativeServer: NativeDevServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  await nativeServer?.close();
  nativeServer = undefined;
});

function write(path: string, text: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A counter app under `folder`, importing its label through the `@` alias. */
function clientApp(folder: string): string {
  write(`${folder}/index.html`, '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>');
  write(`${folder}/src/main.ts`, `import { mount } from '@memoized-dom/runtime';\nimport { App } from './App';\nmount('root', App);\n`);
  write(`${folder}/src/App.tsx`, `import { label } from '@/label';\nexport function App() {\n  let count = 0;\n  return <button onClick={() => count++}>{label} {count}</button>;\n}\n`);
  write(`${folder}/src/label.ts`, `export let label = 'Count';\nexport function rename(next: string) { label = next; }\n`);
  return join(root, folder);
}

/** The folder's Windows short spelling (`C:\Users\THEOPH~1\…`), or null where there is none. */
function shortName(folder: string): string | null {
  if (process.platform !== 'win32') return null;
  // Verbatim, since Node's quoting of arguments would reach `cmd` as part of the path.
  const result = spawnSync('cmd', ['/d', '/c', `for %A in ("${folder}") do @echo %~sA`], {
    encoding: 'utf8', windowsVerbatimArguments: true,
  });
  const short = result.stdout.trim();
  return result.status === 0 && short !== '' && short !== folder ? short : null;
}

function viteConfig(app: string) {
  return {
    root: app,
    configFile: false as const,
    logLevel: 'silent' as const,
    resolve: { alias: { '@': join(app, 'src') } },
    plugins: [memoizedDom({ clientEntry: 'src/main.ts', compiler: 'next' })],
  };
}

describe("compiler: 'next'", () => {
  it('builds a client app, resolving aliases through Vite', async () => {
    const app = clientApp('client');
    await build(viteConfig(app));

    const assets = join(app, 'dist', 'assets');
    const scripts = readdirSync(assets).filter((name) => name.endsWith('.js'));
    expect(scripts).toHaveLength(1);
    const bundle = readFileSync(join(assets, scripts[0]!), 'utf8');
    expect(bundle).toContain('Count');
    // Compiled: no JSX runtime, and no hot replacement in a build.
    expect(bundle).not.toContain('jsx');
    expect(bundle).not.toContain('acceptComponents');
  });

  it('builds a page that cannot change as HTML, with its stylesheets and no script', async () => {
    write('static/index.html', '<!doctype html><html><head><title>static</title></head><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>');
    write('static/src/main.ts', `import './base.css';\nimport { mount } from '@memoized-dom/runtime';\nimport { Page } from './Page';\nmount('root', Page);\n`);
    write('static/src/base.css', 'body { margin: 0; }\n');
    write('static/src/Page.tsx', `export function Page() { return <main><h1>Static</h1></main>; }\n`);
    const app = join(root, 'static');
    await build(viteConfig(app));

    const page = readFileSync(join(app, 'dist', 'index.html'), 'utf8');
    expect(page).toContain('<div id="root"><main><h1>Static</h1></main></div>');
    expect(page).not.toContain('<script');
    // Vite processed the linked stylesheet into a built file.
    expect(page).toMatch(/<link rel="stylesheet"[^>]*href="\/assets\/[^"]+\.css"/);
    expect(readdirSync(join(app, 'dist', 'assets')).filter((name) => name.endsWith('.js'))).toEqual([]);
  });

  it.skipIf(shortName(root) === null)('compiles an app whose entry is given by its Windows short name', async () => {
    const app = clientApp('short');
    const short = shortName(app)!;
    expect(short).not.toBe(app);
    const result = await build({
      ...viteConfig(app),
      build: { write: false, rolldownOptions: { input: join(short, 'src', 'main.ts') } },
    });
    const code = (Array.isArray(result) ? result : [result])
      .flatMap((item) => 'output' in item ? item.output : [])
      .flatMap((output) => output.type === 'chunk' ? [output.code] : [])
      .join('\n');
    // Compiled, not left to Vite's JSX transform, which would import a React runtime.
    expect(code).toContain('Count');
    expect(code).not.toContain('jsx');
  });

  it('serves compiled modules in dev, and an edit sends an update, not a reload', async () => {
    const app = clientApp('dev');
    server = await createServer({ ...viteConfig(app), server: { middlewareMode: true } });
    const transformed = await server.environments.client.transformRequest('/src/App.tsx');
    expect(transformed?.code).toContain('import.meta.hot.accept');
    expect(transformed?.code).not.toContain('<button');
    expect(transformed?.map).toBeTruthy();

    await server.environments.client.transformRequest('/src/main.ts');
    await server.environments.client.transformRequest('/src/label.ts');
    const send = vi.spyOn(server.environments.client.hot, 'send').mockImplementation(() => {});
    type Payload = { type: string; updates?: { path: string; acceptedPath: string }[] };
    const payloads = () => send.mock.calls.map(([payload]) => payload as Payload);
    const accepted = () => payloads().flatMap((payload) => payload.updates ?? []).map((update) => update.acceptedPath);

    // A component module accepts its own update.
    write('dev/src/App.tsx', readFileSync(join(app, 'src/App.tsx'), 'utf8').replace('{label} {count}', '{label}: {count}'));
    await waitFor(() => expect(accepted()).toContain('/src/App.tsx'), { timeout: 15_000 });
    expect(payloads().some((payload) => payload.type === 'full-reload')).toBe(false);

    // A helper's update reaches the component importing it, which accepts it.
    send.mockClear();
    write('dev/src/label.ts', readFileSync(join(app, 'src/label.ts'), 'utf8').replace("'Count'", "'Clicks'"));
    await waitFor(() => expect(accepted()).toContain('/src/App.tsx'), { timeout: 15_000 });
    expect(payloads().some((payload) => payload.type === 'full-reload')).toBe(false);

    // The entry mounts the app, so an edit to it reloads the page.
    send.mockClear();
    write('dev/src/main.ts', `${readFileSync(join(app, 'src/main.ts'), 'utf8')}console.log('edited');\n`);
    await waitFor(() => expect(payloads().some((payload) => payload.type === 'full-reload')).toBe(true), { timeout: 15_000 });
  }, 60_000);

  it('reports a compile error with its place, and the fix sends an update', async () => {
    const app = clientApp('broken');
    server = await createServer({ ...viteConfig(app), server: { middlewareMode: true } });
    await server.environments.client.transformRequest('/src/App.tsx');
    const send = vi.spyOn(server.environments.client.hot, 'send').mockImplementation(() => {});
    const good = readFileSync(join(app, 'src/App.tsx'), 'utf8');

    // An unclosed expression container is a syntax error.
    write('broken/src/App.tsx', good.replace('{label} {count}', '{label} {</'));
    await waitFor(() => {
      const error = send.mock.calls.map(([payload]) => payload as { type: string; err?: { message: string; loc?: { line: number } } })
        .find((payload) => payload.type === 'error');
      expect(error?.err?.loc?.line).toBeGreaterThan(0);
    }, { timeout: 15_000 });

    send.mockClear();
    write('broken/src/App.tsx', good);
    await waitFor(() => {
      expect(send.mock.calls.some(([payload]) => (payload as { type: string }).type === 'update')).toBe(true);
    }, { timeout: 15_000 });
  }, 30_000);

  it('renders the page in development, and renders an edit on the next request', async () => {
    write('live/index.html', '<!doctype html><html><head></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/src/main.ts"></script></body></html>');
    write('live/src/main.ts', `import { mount } from '@memoized-dom/runtime';\nimport { Page } from './Page';\nmount('root', Page);\n`);
    write('live/src/Page.tsx', `export function Page() { return <main><h1>Live</h1></main>; }`);
    write('live/server.ts', `import { serve } from '@memoized-dom/server';\nimport { Page } from './src/Page';\nimport { define } from '#server/define';\nconst app = serve({ define });\napp.get('/health', () => ({ ok: true }));\napp.ssr(Page);\nexport default app;\n`);
    write('live/server/define.ts', `import { createDefine } from '@memoized-dom/server';\nexport const define = createDefine();\n`);
    write('live/server/functions/time.ts', `import { define } from '../define';\nexport const getAnswer = define.function({ async get() { return 42; } });\n`);
    const app = join(root, 'live');

    nativeServer = await createDevServer({
      root: app,
      configFile: false,
      logLevel: 'silent',
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts', server: 'server', compiler: 'next' })],
      server: { host: '127.0.0.1', port: 0 },
    });
    const origin = nativeServer.origin;
    expect(await (await fetch(`${origin}/health`)).json()).toEqual({ ok: true });
    expect(await (await fetch(`${origin}/_fn/time/getAnswer`)).json()).toBe(42);
    const page = await (await fetch(`${origin}/`)).text();
    expect(page).toContain('<h1>Live</h1>');
    // Vite's client, for hot updates.
    expect(page).toContain('/@vite/client');

    write('live/src/Page.tsx', `export function Page() { return <main><h1>Edited</h1></main>; }`);
    await waitFor(async () => {
      expect(await (await fetch(`${origin}/`)).text()).toContain('<h1>Edited</h1>');
    }, { timeout: 15_000 });
  }, 60_000);

  it('builds a server that renders its page, serves its files and answers its server functions', async () => {
    write('full/index.html', '<!doctype html><html><head><title>full</title></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/src/main.ts"></script></body></html>');
    write('full/src/main.ts', `import { mount } from '@memoized-dom/runtime';\nimport { Page } from './Page';\nmount('root', Page);\n`);
    write('full/src/Page.tsx', `export function Page() { return <main><h1>Built</h1></main>; }`);
    write('full/server.ts', `import { serve } from '@memoized-dom/server';\nimport { Page } from './src/Page';\nimport { define } from '#server/define';\nconst app = serve({ define });\napp.ssr(Page);\nexport default app;\n`);
    write('full/server/define.ts', `import { createDefine } from '@memoized-dom/server';\nexport const define = createDefine();\n`);
    write('full/server/functions/time.ts', `import { define } from '../define';\nexport const getAnswer = define.function({ async get() { return 42; } });\n`);
    const app = join(root, 'full');

    const builder = await createBuilder({
      root: app,
      configFile: false,
      logLevel: 'silent',
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts', server: 'server', compiler: 'next' })],
    });
    await builder.buildApp();
    expect(existsSync(join(app, 'dist', 'client', 'index.html'))).toBe(true);
    // TypeScript's types for `#server-functions`.
    expect(readFileSync(join(app, '.memoized', 'server-functions.d.ts'), 'utf8')).toContain('getAnswer');

    const { default: host } = await import(pathToFileURL(join(app, 'dist', 'server.js')).href);
    const html = await (await host.fetch(new Request('http://localhost/'))).text();
    expect(html).toContain('<h1>Built</h1>');
    const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
    expect(script).toBeDefined();
    const asset = await host.fetch(new Request(new URL(script!, 'http://localhost/')));
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('hydrat');

    const answer = await host.fetch(new Request('http://localhost/_fn/time/getAnswer'));
    expect(await answer.json()).toBe(42);
  }, 60_000);
});
