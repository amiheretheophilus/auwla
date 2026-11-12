import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArguments, run } from './cli';

// Inside the package (not `src/`), so a build finds the workspace's packages as an app finds its own.
const root = mkdtempSync(join(import.meta.dir, '../../.cli-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

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
});
