import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { parseArguments, run } from './cli';

// Inside the package (not `src/`), so a build finds the workspace's packages as an app finds its own.
const root = mkdtempSync(join(import.meta.dir, '../../.cli-test-'));
/** Workers started by a test, stopped before their files are removed (workerd holds them open). */
const running: Miniflare[] = [];
afterAll(async () => {
  for (const worker of running) await worker.dispose();
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, text: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
}

write('src/App.tsx', 'export function App() { return <p>hi</p>; }');
write('src/Broken.tsx', 'export function Broken() { return <p>{</p>; }');

describe('the command line', () => {
  it('reads its commands and options', () => {
    expect(parseArguments(['check', 'src/App.tsx'], root)).toMatchObject({ name: 'check', client: './src/App.tsx', root });
    expect(parseArguments(['build', 'src/App.tsx', '--out', 'out', '--minify'], root))
      .toMatchObject({ name: 'build', out: join(root, 'out'), minify: true });
    expect(parseArguments(['build', 'src/main.ts', '--server', 'server.ts', '--server-folder', 'server'], root))
      .toMatchObject({ server: { entry: './server.ts', folder: './server' } });
    expect(parseArguments(['build'], root)).toContain('usage');
    expect(parseArguments(['build', 'src/App.tsx', '--wat'], root)).toContain('unknown or incomplete option: --wat');
    expect(parseArguments(['build', 'src/App.tsx', '--server-folder', 'server'], root)).toContain('--server-folder needs --server');
  });

  it('checks an application, reporting the first error with its module', async () => {
    const lines: string[] = [];
    expect(await run(parseArguments(['check', 'src/App.tsx'], root) as never, (line) => lines.push(line))).toBe(0);
    expect(lines).toEqual(['ok: client, 1 modules compiled']);

    lines.length = 0;
    expect(await run(parseArguments(['check', 'src/Broken.tsx'], root) as never, (line) => lines.push(line))).toBe(1);
    expect(lines.join('\n')).toContain('Broken.tsx');
  });

  it('builds a client into its output folder, with source maps', async () => {
    const command = parseArguments(['build', 'src/App.tsx', '--out', 'dist'], root);
    if (typeof command === 'string') throw new Error(command);
    expect(await run(command, () => {})).toBe(0);
    expect(existsSync(join(root, 'dist', 'App.js'))).toBe(true);
    expect(readdirSync(join(root, 'dist')).some((name) => name.endsWith('.map'))).toBe(true);
    // The markup compiled to a template, with the runtime bundled in.
    const bundle = await Bun.file(join(root, 'dist', 'App.js')).text();
    expect(bundle).toContain('_template');
    expect(bundle).toContain('runtime/dist/markup.js');
  });

  it('builds a page that cannot change as HTML, with its stylesheet and no script', async () => {
    write('static/index.html', '<!doctype html><html><head><title>static</title></head><body><div id="root"></div><script type="module" src="./src/main.ts"></script></body></html>');
    write('static/src/main.ts', `import './base.css';\nimport { mount } from '@memoized-dom/runtime';\nimport { Page } from './Page';\nmount('root', Page);\n`);
    write('static/src/base.css', 'body { margin: 0; }\n');
    write('static/src/Page.tsx', 'export function Page() { return <main><h1>Static</h1></main>; }\n');
    const app = join(root, 'static');
    const command = parseArguments(['build', 'src/main.ts', '--out', 'dist'], app);
    if (typeof command === 'string') throw new Error(command);
    expect(await run(command, () => {})).toBe(0);

    const page = await Bun.file(join(app, 'dist', 'index.html')).text();
    expect(page).toContain('<div id="root"><main><h1>Static</h1></main></div>');
    expect(page).not.toContain('<script');
    expect(page).toMatch(/<link rel="stylesheet"[^>]*href="[^"]+\.css"/);
    expect(readdirSync(join(app, 'dist')).filter((name) => name.endsWith('.js'))).toEqual([]);
  });

  it('builds a component imported only for its route as a chunk of its own', async () => {
    write('lazy/src/main.ts', `import { mount } from '@memoized-dom/runtime';\nimport { App } from './App';\nmount('root', App);\n`);
    write('lazy/src/App.tsx', `import { Profile } from './pages/Profile';\nexport function App() { return <main><p route="/">Home</p><Profile route="/profile" /></main>; }\n`);
    write('lazy/src/pages/Profile.tsx', `export function Profile() { return <h1>ProfilePageMarker</h1>; }\n`);
    const app = join(root, 'lazy');
    const command = parseArguments(['build', 'src/main.ts', '--out', 'dist'], app);
    if (typeof command === 'string') throw new Error(command);
    expect(await run(command, () => {})).toBe(0);

    const scripts = readdirSync(join(app, 'dist')).filter((name) => name.endsWith('.js'));
    const texts = await Promise.all(scripts.map((name) => Bun.file(join(app, 'dist', name)).text()));
    const entry = texts[scripts.indexOf('main.js')]!;
    // The page's own script loads the route's chunk when the route is chosen, not with itself.
    expect(scripts.length).toBeGreaterThan(1);
    expect(entry).not.toContain('ProfilePageMarker');
    expect(texts.some((text) => text.includes('ProfilePageMarker'))).toBe(true);
  });

  it('builds a server that serves its page, its files and its server functions', async () => {
    write('full/index.html', '<!doctype html><html><head><title>full</title></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="./src/main.ts"></script></body></html>');
    write('full/src/main.ts', `import { mount } from '@memoized-dom/runtime';\nimport { Page } from './Page';\nmount('root', Page);\n`);
    write('full/src/Page.tsx', `export function Page() { return <main><h1>Built</h1></main>; }`);
    write('full/server.ts', `import { serve } from '@memoized-dom/server';\nimport { Page } from './src/Page';\nimport { define } from '#server/define';\nconst app = serve({ define });\napp.ssr(Page);\nexport default app;\n`);
    write('full/server/define.ts', `import { createDefine } from '@memoized-dom/server';\nexport const define = createDefine();\n`);
    write('full/server/functions/time.ts', `import { define } from '../define';\nexport const getAnswer = define.function({ async get() { return 42; } });\n`);

    const full = join(root, 'full');
    const command = parseArguments(['build', 'src/main.ts', '--server', 'server.ts', '--server-folder', 'server'], full);
    if (typeof command === 'string') throw new Error(command);
    const lines: string[] = [];
    expect(await run(command, (line) => lines.push(line))).toBe(0);
    expect(existsSync(join(full, 'dist', 'server.js'))).toBe(true);
    expect(existsSync(join(full, 'dist', 'client', 'index.html'))).toBe(true);

    const { default: app } = await import(pathToFileURL(join(full, 'dist', 'server.js')).href);
    const html = await (await app.fetch(new Request('http://localhost/'))).text();
    expect(html).toContain('<h1>Built</h1>');
    const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
    expect(script).toBeDefined();

    const asset = await app.fetch(new Request(new URL(script!, 'http://localhost/')));
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    // The browser's copy hydrates the server's markup.
    expect(await asset.text()).toContain('hydrat');

    const answer = await app.fetch(new Request('http://localhost/_fn/time/getAnswer'));
    expect(await answer.json()).toBe(42);
  });

  it('builds the server as a Cloudflare Worker that renders, serves its assets and answers in workerd', async () => {
    write('worker/index.html', '<!doctype html><html><head><title>worker</title></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="./src/main.ts"></script></body></html>');
    write('worker/src/main.ts', `import { mount } from '@memoized-dom/runtime';\nimport { Page } from './Page';\nmount('root', Page);\n`);
    write('worker/src/Page.tsx', `let visits = 0;\nexport function Page() { visits++; return <main><h1>On a Worker</h1><p>{visits}</p></main>; }`);
    write('worker/server.ts', `import { serve } from '@memoized-dom/server';\nimport { Page } from './src/Page';\nimport { define } from '#server/define';\nconst app = serve({ define });\napp.ssr(Page);\nexport default app;\n`);
    write('worker/server/define.ts', `import { createDefine } from '@memoized-dom/server';\nexport const define = createDefine();\n`);
    write('worker/server/functions/time.ts', `import { define } from '../define';\nexport const getAnswer = define.function({ async get() { return 42; } });\n`
      // A Worker's bindings reach the application as `platform.env` (`server/application.ts`).
      + `export const getMessage = define.function({ async get(context) { return context.platform.env.MESSAGE; } });\n`);

    const folder = join(root, 'worker');
    expect(parseArguments(['build', 'src/main.ts', '--runtime', 'cloudflare'], folder)).toContain('--runtime needs --server');
    const command = parseArguments(['build', 'src/main.ts', '--server', 'server.ts', '--server-folder', 'server', '--runtime', 'cloudflare'], folder);
    if (typeof command === 'string') throw new Error(command);
    const lines: string[] = [];
    expect(await run(command, (line) => lines.push(line)), lines.join('\n')).toBe(0);

    const config = JSON.parse(readFileSync(join(folder, 'dist', 'wrangler.json'), 'utf8'));
    expect(config).toMatchObject({
      main: './worker.js',
      compatibility_flags: ['nodejs_compat'],
      assets: { directory: './client', binding: 'ASSETS', run_worker_first: true },
    });

    // workerd, as `wrangler dev` runs it, with the client uploaded as the Worker's assets.
    const worker = new Miniflare(convertV4MiniflareOptions({
      modules: true,
      // One file: the Worker is bundled without chunks.
      scriptPath: join(folder, 'dist', 'worker.js'),
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      bindings: { MESSAGE: 'from a binding' },
      assets: {
        directory: join(folder, 'dist', 'client'), binding: 'ASSETS', run_worker_first: true,
        routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true },
      },
    }));
    running.push(worker);
    // Miniflare's own fetch cannot reach workerd under Bun; Bun's fetch can, at its address.
    const address = await worker.ready;
    const fetchWorker = (path: string) => fetch(new URL(path, address));
    const page = await (await fetchWorker('/')).text();
    expect(page).toContain('<h1>On a Worker</h1>');
    // Each render owns the module state it writes, on a Worker too.
    expect(await (await fetchWorker('/')).text()).toContain('<p>1</p>');

    const script = /<script[^>]+src="([^"]+)"/.exec(page)?.[1];
    expect(script).toBeDefined();
    const asset = await fetchWorker(new URL(script!, 'http://localhost/').pathname);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('hydrat');

    expect(await (await fetchWorker('/_fn/time/getAnswer')).json()).toBe(42);
    // workerd calls the Worker as `fetch(request, env, ctx)`; found by the Vite acceptance run.
    expect(await (await fetchWorker('/_fn/time/getMessage')).text()).toContain('from a binding');
  }, 60_000);
});
