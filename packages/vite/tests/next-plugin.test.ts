/**
 * The Vite plugin over the compiler's applications (`src/plugin.ts`): builds, dev transforms,
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
    plugins: [memoizedDom({ clientEntry: 'src/main.ts' })],
  };
}

describe('the Vite plugin', () => {
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
      const error = send.mock.calls.map(([payload]) => payload as { type: string; err?: { message: string; stack: string; loc?: { line: number } } })
        .find((payload) => payload.type === 'error');
      expect(error?.err?.loc?.line).toBeGreaterThan(0);
      // The mistake is the author's: no frame of the plugin's own code follows it.
      expect(error?.err?.stack).not.toMatch(/\n\s*at /);
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
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts', server: 'server' })],
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

  it('starts while a page fails to compile, shows the error, and renders the page once it is fixed', async () => {
    write('starts-broken/index.html', '<!doctype html><html><head></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/src/main.ts"></script></body></html>');
    write('starts-broken/src/main.ts', `import { mount } from '@memoized-dom/runtime';\nimport { Page } from './Page';\nmount('root', Page);\n`);
    write('starts-broken/src/Page.tsx', `export function Page() { return <main><h1>{</h1></main>; }`);
    write('starts-broken/server.ts', `import { serve } from '@memoized-dom/server';\nimport { Page } from './src/Page';\nimport { define } from '#server/define';\nconst app = serve({ define });\napp.ssr(Page);\nexport default app;\n`);
    write('starts-broken/server/define.ts', `import { createDefine } from '@memoized-dom/server';\nexport const define = createDefine();\n`);

    nativeServer = await createDevServer({
      root: join(root, 'starts-broken'),
      configFile: false,
      logLevel: 'silent',
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts', server: 'server' })],
      server: { host: '127.0.0.1', port: 0 },
    });
    const page = () => fetch(`${nativeServer!.origin}/`, { headers: { accept: 'text/html' } });
    const broken = await page();
    expect(broken.status).toBe(500);
    const overlay = await broken.text();
    expect(overlay).toContain('Development error');
    // The overlay shows the author's file and its code frame, not the module runner's stack.
    expect(overlay).toContain('Page.tsx');
    expect(overlay).not.toContain('module-runner');

    write('starts-broken/src/Page.tsx', `export function Page() { return <main><h1>Fixed</h1></main>; }`);
    await waitFor(async () => {
      expect(await (await page()).text()).toContain('<h1>Fixed</h1>');
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
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts', server: 'server' })],
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

  it('links a lazy route\'s styles in the head of a page the server renders', async () => {
    write('styled/index.html', '<!doctype html><html><head><title>styled</title></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/src/main.ts"></script></body></html>');
    write('styled/src/main.ts', `import { mount } from '@memoized-dom/runtime';\nimport { App } from './App';\nmount('root', App);\n`);
    write('styled/src/App.tsx', `import { Profile } from './Profile';
export function App() {
  return <main><p route="/">Home</p><Profile route="/profile" /></main>;
}
`);
    // Imported only for its route, so the browser loads it, and its stylesheet, with the route.
    write('styled/src/Profile.tsx', `import './profile.css';\nexport function Profile() { return <h2 class="profile">Profile</h2>; }\n`);
    write('styled/src/profile.css', '.profile { color: rebeccapurple; }\n');
    write('styled/server.ts', `import { serve } from '@memoized-dom/server';\nimport { App } from './src/App';\nimport { define } from '#server/define';\nconst app = serve({ define });\napp.ssr(App);\nexport default app;\n`);
    write('styled/server/define.ts', `import { createDefine } from '@memoized-dom/server';\nexport const define = createDefine();\n`);
    const app = join(root, 'styled');

    const builder = await createBuilder({
      root: app,
      configFile: false,
      logLevel: 'silent',
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts', server: 'server' })],
    });
    await builder.buildApp();
    const { default: host } = await import(pathToFileURL(join(app, 'dist', 'server.js')).href);

    // The route's chunk has its own stylesheet, which the entry's page does not link.
    const assets = join(app, 'dist', 'client', 'assets');
    const css = readdirSync(assets).filter((file) => file.endsWith('.css'));
    // Minified, so found by its selector (the color becomes `#639`).
    const own = css.find((file) => readFileSync(join(assets, file), 'utf8').includes('.profile'));
    expect(own).toBeDefined();
    expect(readFileSync(join(app, 'dist', 'client', 'index.html'), 'utf8')).not.toContain(own!);

    // The page for its route links it before the head closes, so it shows styled at once.
    const profile = await (await host.fetch(new Request('http://localhost/profile'))).text();
    expect(profile).toContain('<h2 class="profile">Profile</h2>');
    const head = profile.slice(0, profile.indexOf('</head>'));
    expect(head).toContain(`<link rel="stylesheet" href="/assets/${own!}">`);

    // Another route's page does not.
    const home = await (await host.fetch(new Request('http://localhost/'))).text();
    expect(home).toContain('Home');
    expect(home).not.toContain(own!);
  }, 60_000);

  it('links only the matched route\'s styles in a page rendered in development, as after a build', async () => {
    write('dev-styled/index.html', '<!doctype html><html><head></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/src/main.ts"></script></body></html>');
    write('dev-styled/src/main.ts', `import './base.css';\nimport { mount } from '@memoized-dom/runtime';\nimport { App } from './App';\nmount('root', App);\n`);
    write('dev-styled/src/App.tsx', `import { Home } from './Home';
import { Detail } from './Detail';
export function App() {
  return <main><Home route="/" /><Detail route="/detail" /></main>;
}
`);
    write('dev-styled/src/Home.tsx', `import './home.css';\nexport function Home() { return <p>Home</p>; }\n`);
    write('dev-styled/src/Detail.tsx', `import './detail.css';\nexport function Detail() { return <p>Detail</p>; }\n`);
    write('dev-styled/src/base.css', 'main { color: black; }\n');
    // Both color the same element: a page showing the other route's stylesheet would show it wrong.
    write('dev-styled/src/home.css', 'p { color: blue; }\n');
    write('dev-styled/src/detail.css', 'p { color: red; }\n');
    write('dev-styled/server.ts', `import { serve } from '@memoized-dom/server';\nimport { App } from './src/App';\nimport { define } from '#server/define';\nconst app = serve({ define });\napp.ssr(App);\nexport default app;\n`);
    write('dev-styled/server/define.ts', `import { createDefine } from '@memoized-dom/server';\nexport const define = createDefine();\n`);

    nativeServer = await createDevServer({
      root: join(root, 'dev-styled'),
      configFile: false,
      logLevel: 'silent',
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts', server: 'server' })],
      server: { host: '127.0.0.1', port: 0 },
    });
    const head = async (path: string) => {
      const page = await (await fetch(`${nativeServer!.origin}${path}`)).text();
      return page.slice(0, page.indexOf('</head>'));
    };

    const home = await head('/');
    expect(home).toContain('/src/base.css');
    expect(home).toContain('/src/home.css');
    expect(home).not.toContain('/src/detail.css');
    const detail = await head('/detail');
    expect(detail).toContain('/src/base.css');
    expect(detail).toContain('/src/detail.css');
    expect(detail).not.toContain('/src/home.css');
  }, 60_000);

  it('builds a server-backed $routed page: rendered with its value, prepared on request, kept out of the client', async () => {
    write('routed/index.html', '<!doctype html><html><head></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/src/main.ts"></script></body></html>');
    write('routed/src/main.ts', `import { mount } from '@memoized-dom/runtime';\nimport { App } from './App';\nmount('root', App);\n`);
    write('routed/src/App.tsx', `import { Person } from './Person';
export function App() {
  return <main><a class="home" route-to="/">Home</a><p route="/">Everyone</p><Person route="/people/:id" /></main>;
}
`);
    // Reading server-only code makes the preparation server-backed (\`wiki/compiler/routes.md\`).
    write('routed/src/Person.tsx', `import { findPerson } from '#server/people';
export function Person() {
  const person = $routed(({ params }) => findPerson(params.id));
  return <article>{person === null ? <p>Nobody</p> : <h2>{person.name}, {person.role}</h2>}</article>;
}
`);
    write('routed/server/people.ts', `const people = [{ id: '1', name: 'Ada', role: 'Engineer-only-on-the-server' }];
export function findPerson(id: string) { return people.find((person) => person.id === id) ?? null; }
`);
    write('routed/server.ts', `import { serve } from '@memoized-dom/server';\nimport { App } from './src/App';\nimport { define } from '#server/define';\nconst app = serve({ define });\napp.ssr(App);\nexport default app;\n`);
    write('routed/server/define.ts', `import { createDefine } from '@memoized-dom/server';\nexport const define = createDefine();\n`);
    const app = join(root, 'routed');

    const builder = await createBuilder({
      root: app,
      configFile: false,
      logLevel: 'silent',
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts', server: 'server' })],
    });
    await builder.buildApp();
    const { default: host } = await import(pathToFileURL(join(app, 'dist', 'server.js')).href);

    // Rendered on the server with the prepared value, which travels with the page.
    const html = await (await host.fetch(new Request('http://localhost/people/1'))).text();
    expect(html).toContain('<h2>Ada, Engineer-only-on-the-server</h2>');

    // The endpoint a client navigation asks.
    const prepared = await host.fetch(new Request('http://localhost/_memoized/routed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: './src/Person.tsx#routed:Person:0', href: '/people/1', params: { id: '1' }, state: {} }),
    }));
    expect(prepared.status).toBe(200);
    expect(JSON.stringify(await prepared.json())).toContain('Ada');

    // The client asks for it instead: the server-only module never ships.
    const assets = join(app, 'dist', 'client', 'assets');
    const client = readdirSync(assets).filter((file) => file.endsWith('.js')).map((file) => readFileSync(join(assets, file), 'utf8')).join('\n');
    expect(client).toContain('/_memoized/routed');
    expect(client).not.toContain('Engineer-only-on-the-server');
  }, 60_000);
});
