import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { memoizedDom } from './bun';
import { createProject, fileSystemHost } from '.';

// Inside the package (not `src/`), so a build finds the workspace's packages as an app finds its own.
const root = mkdtempSync(join(import.meta.dir, '../../.bun-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, text: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
}

// Read through a namespace, a module with state keeps its readers in a companion output, which
// exists only in the build (`linking.md`).
write('src/main.tsx', `
import { mount } from '@memoized-dom/runtime';
import * as app from './App';
mount(app.App, document.body);
`);
write('src/App.tsx', `
import { Title } from './Title';
import './styles.css';
export let clicks = 0;
export function App() { return <main><Title text="hi" /><button onClick={() => clicks++}>{clicks}</button></main>; }
`);
write('src/Title.tsx', 'export function Title({ text }: { text: string }) { return <h1>{text}</h1>; }');
write('src/styles.css', 'main { color: red; }');

describe('client builds', () => {
  it('bundle an app, its modules compiled and its companion outputs found', async () => {
    // The app has a companion output, which Bun must resolve through the plugin.
    const project = await createProject({ entries: ['./src/main.tsx'], host: fileSystemHost(root) }).build();
    expect(project.ok && Object.keys(project.output).some((path) => /\.mmd\./.test(path))).toBe(true);

    const result = await Bun.build({
      entrypoints: [join(root, 'src/main.tsx')],
      plugins: [memoizedDom({ client: './src/main.tsx', root })],
      external: ['@memoized-dom/*'],
      sourcemap: 'external',
    });

    expect(result.success).toBe(true);
    const script = result.outputs.find((output) => output.path.endsWith('.js'))!;
    const code = await script.text();
    // Compiled: templates instead of JSX calls, and the runtime imported by the output.
    expect(code).toContain('createTemplateCache');
    expect(code).not.toContain('jsx(');
    expect(code).toContain('@memoized-dom/runtime');
    // The styles went to Bun, as a bundler's asset.
    expect(result.outputs.some((output) => output.path.endsWith('.css'))).toBe(true);
  });

  it('report a compile error with its module', async () => {
    write('src/Broken.tsx', 'export function Broken() { return <p>{</p>; }');
    write('src/broken-main.tsx', `import { Broken } from './Broken'; console.log(Broken);`);
    const result = await Bun.build({
      entrypoints: [join(root, 'src/broken-main.tsx')],
      plugins: [memoizedDom({ client: './src/broken-main.tsx', root })],
      external: ['@memoized-dom/*'],
      throw: false,
    });
    expect(result.success).toBe(false);
    expect(result.logs.map((log) => log.message).join('\n')).toContain('Broken.tsx');
  });
});

describe('server builds', () => {
  write('app/src/main.ts', `import { mount } from '@memoized-dom/runtime';\nimport { Page } from './Page';\nmount('root', Page);\n`);
  write('app/src/Page.tsx', `
const greeting = 'Hello from the server';
export function Page() { return <main><h1>{greeting}</h1><p>rendered</p></main>; }
`);
  write('app/server.ts', `
import { serve } from '@memoized-dom/server';
import { Page } from './src/Page';
import { define } from '#server/define';
import { greet } from '#server/greet';
const app = serve({ define });
app.ssr(Page);
app.get('/health', () => Response.json({ ok: true, greeting: greet('health') }));
export default app;
`);
  write('app/server/greet.ts', 'export function greet(name: string) { return `hi ${name}`; }');
  write('app/server/define.ts', `import { createDefine } from '@memoized-dom/server';\nexport const define = createDefine();\n`);
  write('app/server/functions/users.ts', `
import { define } from '../define';
import { greet } from '../greet';
export const getUser = define.function({ async get(_context, id: string) { return { id, name: greet(id) }; } });
`);

  const delivery = `export default {
    document: () => '<!doctype html><html><head><title>t</title></head><body><div id="root"><!--ssr-outlet--></div></body></html>',
    assets: () => undefined,
  };`;

  it('bundle a server that renders pages and answers its server functions', async () => {
    const appRoot = join(root, 'app');
    const result = await Bun.build({
      entrypoints: [join(appRoot, 'server.ts')],
      outdir: join(appRoot, 'dist'),
      target: 'bun',
      plugins: [memoizedDom({
        client: './src/main.ts', server: { entry: './server.ts', folder: './server' }, target: 'server', delivery, root: appRoot,
      })],
      throw: false,
    });
    expect(result.logs.map((log) => String(log.message))).toEqual([]);
    expect(result.success).toBe(true);

    const { default: app } = await import(pathToFileURL(join(appRoot, 'dist', 'server.js')).href);
    const page = await app.fetch(new Request('http://localhost/'));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<h1>Hello from the server</h1>');
    expect(html).toContain('<div id="root">');

    const health = await app.fetch(new Request('http://localhost/health'));
    expect(await health.json()).toEqual({ ok: true, greeting: 'hi health' });

    const user = await app.fetch(new Request('http://localhost/_fn/users/getUser?id=7'));
    expect(user.status).toBe(200);
    expect(await user.json()).toEqual({ id: '7', name: 'hi 7' });
  });
});
