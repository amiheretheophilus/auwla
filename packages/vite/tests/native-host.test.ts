import { mkdir, mkdtemp, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { afterEach, describe, expect, it } from 'bun:test';
import { createBuilder } from 'vite';
import memoizedDom from '../src';
import { createDevServer, type NativeDevServer } from '../src/dev';
import { waitFor } from '../../../test-support/helpers';

let fixture: string | undefined;
let development: NativeDevServer | undefined;
afterEach(async () => {
  await development?.close(); development = undefined;
  if (fixture) await rm(fixture, { recursive: true, force: true });
  fixture = undefined;
});

const component = (label: string) => `export function App() {
  let count = 0;
  return <main><h1>${label}</h1><button onClick={() => count++}>{count}</button></main>;
}`;
const backend = (label: string) => `import { Hono } from 'hono';
import { serve } from '@memoized-dom/server';
import { App } from './src/App';
import { define } from './server/define';
const mmd = serve({ define });
mmd.get('/api/framework', context => ({ label: '${label}', nativePort: context.platform?.port }));
mmd.ssr(App);
const backend = new Hono();
backend.get('/api/native', c => c.json({ label: '${label}', bun: Bun.version, port: c.env.port }));
backend.all('*', c => mmd.fetch(c.req.raw, { platform: c.env }));
export default backend;`;

async function project(): Promise<string> {
  const parent = resolve(import.meta.dirname, 'fixtures/out');
  await mkdir(parent, { recursive: true });
  fixture = await mkdtemp(join(parent, 'native-host-'));
  await mkdir(join(fixture, 'src'));
  await mkdir(join(fixture, 'server/functions'), { recursive: true });
  await mkdir(join(fixture, 'public'));
  await writeFile(join(fixture, 'public/robots.txt'), 'User-agent: *');
  await writeFile(join(fixture, 'index.html'), '<!doctype html><html><head><title>Native host</title></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/src/main.ts"></script></body></html>');
  await writeFile(join(fixture, 'src/main.ts'), `import './style.css'; import { mount } from '@memoized-dom/runtime'; import { App } from './App'; mount('root', App);`);
  await writeFile(join(fixture, 'src/style.css'), 'h1 { color: rgb(12, 34, 56); }');
  await writeFile(join(fixture, 'src/App.tsx'), component('Before'));
  await writeFile(join(fixture, 'server/define.ts'), `import { createDefine } from '@memoized-dom/server';
export const define = createDefine<Record<string, never>, { port: number }>();`);
  await writeFile(join(fixture, 'server.ts'), backend('before'));
  await writeFile(join(fixture, 'server/functions/greeting.ts'), `import { define } from '../define';
export const greeting = define.function.get(async (_context, name: string) => ({ greeting: 'Hello ' + name }));`);
  return fixture;
}

describe('backend-owned fullstack integration', () => {
  it('disposes initialized application services when the native listener cannot start', async () => {
    const root = await project();
    const marker = join(root, 'disposed.txt');
    await writeFile(join(root, 'server.ts'), `export default { fetch: () => new Response('Ready') };
      export async function dispose() { await Bun.write(${JSON.stringify(marker)}, 'closed'); }`);
    const occupied = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('Occupied') });
    try {
      await expect(createDevServer({ root, configFile: false, logLevel: 'silent',
        plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts' })],
        server: { port: occupied.port } })).rejects.toThrow();
      expect(await readFile(marker, 'utf8')).toBe('closed');
    } finally { await occupied.stop(true); }
  }, 30_000);

  it('runs Hono on native Bun, installs nested SSR/functions/assets, and reloads server modules', async () => {
    const root = await project();
    development = await createDevServer({ root, configFile: false, logLevel: 'silent',
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts' })], server: { port: 0 } });
    expect(development.runtime).toBe('bun');
    const origin = development.origin;
    const native = await (await fetch(origin + '/api/native')).json();
    expect(native).toEqual({ label: 'before', bun: Bun.version, port: Number(new URL(origin).port) });
    expect(await (await fetch(origin + '/api/framework')).json()).toEqual({ label: 'before', nativePort: native.port });
    const html = await (await fetch(origin)).text();
    expect(html).toContain('<h1>Before</h1>');
    expect(html).toContain('/@vite/client');
    expect(html).toContain('data-memoized-dom-dev');
    expect((await fetch(origin + '/src/main.ts')).headers.get('content-type')).toContain('javascript');
    expect(await (await fetch(origin + '/_fn/greeting/greeting?name=Ada')).json()).toEqual({ greeting: 'Hello Ada' });
    const toolingAddress = development.vite.httpServer!.address();
    if (!toolingAddress || typeof toolingAddress === 'string') throw new Error('Missing tooling address');
    expect(toolingAddress.port).not.toBe(native.port);
    expect((await fetch(`http://127.0.0.1:${toolingAddress.port}/api/native`)).status).toBe(404);

    await writeFile(join(root, 'server.ts'), backend('after'));
    await waitFor(async () => expect(await (await fetch(origin + '/api/native')).json()).toEqual({ label: 'after', bun: Bun.version, port: native.port }), 10_000);
    await writeFile(join(root, 'src/App.tsx'), component('After'));
    await waitFor(async () => expect(await (await fetch(origin)).text()).toContain('<h1>After</h1>'), 10_000);
    await writeFile(join(root, 'server/functions/greeting.ts'), `import { define } from '../define';
export const greeting = define.function.get(async (_context, name: string) => ({ greeting: 'Updated ' + name }));`);
    await waitFor(async () => expect(await (await fetch(origin + '/_fn/greeting/greeting?name=Ada')).json()).toEqual({ greeting: 'Updated Ada' }), 10_000);
    for (const label of ['second', 'third']) {
      await writeFile(join(root, 'server.ts'), backend(label));
      await waitFor(async () => expect(await (await fetch(origin + '/api/native')).json()).toMatchObject({ label }), 10_000);
      await writeFile(join(root, 'src/App.tsx'), component(label));
      await waitFor(async () => expect(await (await fetch(origin)).text()).toContain('<h1>' + label + '</h1>'), 10_000);
    }
  }, 60_000);

  const chrome = [process.env.MMD_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium']
    .find((path): path is string => !!path && existsSync(path));
  it.skipIf(!chrome)('hydrates and updates components and CSS without a browser reload on native Bun', async () => {
    const root = await project();
    development = await createDevServer({ root, configFile: false, logLevel: 'silent',
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts' })], server: { port: 0 } });
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(String(error)));
      await page.goto(development.origin, { waitUntil: 'networkidle0' });
      await page.click('button');
      await page.waitForFunction(() => document.querySelector('button')?.textContent === '1');
      await page.evaluate(() => { document.documentElement.dataset.hmrProbe = 'kept'; });
      await writeFile(join(root, 'src/App.tsx'), component('After'));
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'After');
      // The existing component HMR contract remounts a changed factory.
      expect(await page.$eval('button', element => element.textContent)).toBe('0');
      expect(await page.evaluate(() => document.documentElement.dataset.hmrProbe)).toBe('kept');
      await writeFile(join(root, 'src/style.css'), 'h1 { color: rgb(65, 43, 21); }');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('h1')!).color === 'rgb(65, 43, 21)');
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  }, 60_000);

  it('keeps in-flight streams alive and disposes retired server generations after they drain', async () => {
    const root = await project();
    const key = `native-dispose-${crypto.randomUUID()}`;
    const streamBackend = (version: string) => `export default { fetch(request) {
      if (new URL(request.url).pathname !== '/stream') return new Response('${version}');
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('${version}:start'));
        const timer = setTimeout(() => { controller.enqueue(new TextEncoder().encode(':end')); controller.close(); }, 3000);
        this.timer = timer;
      }, cancel() { clearTimeout(this.timer); } }));
    } };
    export function dispose() { (globalThis[${JSON.stringify(key)}] ??= []).push('${version}'); }`;
    await writeFile(join(root, 'server.ts'), streamBackend('old'));
    development = await createDevServer({ root, configFile: false, logLevel: 'silent',
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts' })], server: { port: 0 } });
    const stream = await fetch(development.origin + '/stream');
    const reader = stream.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('old:start');
    await writeFile(join(root, 'server.ts'), streamBackend('new'));
    await waitFor(async () => expect(await (await fetch(development!.origin)).text()).toBe('new'), 10_000);
    expect(Reflect.get(globalThis, key) ?? []).toEqual([]);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(':end');
    expect((await reader.read()).done).toBe(true);
    await waitFor(() => expect(Reflect.get(globalThis, key)).toEqual(['old']), 10_000);
    await development.close(); development = undefined;
    expect(Reflect.get(globalThis, key)).toEqual(['old', 'new']);
    Reflect.deleteProperty(globalThis, key);
  }, 60_000);

  it('exposes the actual Bun server for native WebSocket upgrades', async () => {
    const root = await project();
    await writeFile(join(root, 'server.ts'), `export default {
      fetch(request, server) {
        if (server.upgrade(request, { data: { label: 'native' } })) return;
        return new Response('Upgrade required', { status: 426 });
      },
      websocket: { message(socket, message) { socket.send(socket.data.label + ':' + message); } }
    };`);
    development = await createDevServer({ root, configFile: false, logLevel: 'silent',
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts' })], server: { port: 0 } });
    const socket = new WebSocket(development.origin.replace('http:', 'ws:'));
    try {
      const message = new Promise<string>((done, reject) => {
        socket.onopen = () => socket.send('hello');
        socket.onmessage = event => done(String(event.data));
        socket.onerror = reject;
      });
      expect(await message).toBe('native:hello');
    } finally { socket.close(); }
  }, 30_000);

  it('runs actual Node in development and production with native request bindings and server HMR', async () => {
    const root = await project();
    const source = (label: string) => `import { Hono } from 'hono';
      import { serve } from '@memoized-dom/server'; import { App } from './src/App';
      import { define } from './server/define';
      const app = serve({ define }); app.ssr(App);
      const backend = new Hono();
      backend.get('/api/native', c => c.json({ label: '${label}', node: process.versions.node, method: c.env.incoming.method }));
      backend.all('*', c => app.fetch(c.req.raw, { platform: c.env })); export default backend;`;
    await writeFile(join(root, 'server.ts'), source('before'));
    await writeFile(join(root, 'launch.mjs'), `import { createDevServer } from '@memoized-dom/vite/dev';
      import memoizedDom from '@memoized-dom/vite';
      const server = await createDevServer({ root: import.meta.dirname, configFile: false, logLevel: 'silent',
        plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts', runtime: 'node' })], server: { port: 0 } });
      console.log(JSON.stringify({ origin: server.origin, runtime: server.runtime }));
      process.on('SIGTERM', async () => { await server.close(); process.exit(0); });`);
    const child = spawn('node', [join(root, 'launch.mjs')], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { errors += chunk.toString(); });
    try {
      await waitFor(() => expect(output, errors).toContain('"origin"'), 15_000);
      const { origin, runtime } = JSON.parse(output.trim());
      expect(runtime).toBe('node');
      expect(await (await fetch(origin + '/api/native')).json()).toMatchObject({ label: 'before', method: 'GET', node: expect.any(String) });
      expect(await (await fetch(origin)).text()).toContain('<h1>Before</h1>');
      expect((await fetch(origin + '/src/main.ts')).headers.get('content-type')).toContain('javascript');
      await writeFile(join(root, 'server.ts'), source('after'));
      await waitFor(async () => expect(await (await fetch(origin + '/api/native')).json()).toMatchObject({ label: 'after' }), 10_000);
    } finally {
      child.kill();
      await new Promise<void>(done => child.exitCode !== null ? done() : child.once('exit', () => done()));
    }
    await writeFile(join(root, 'server.ts'), source('production').replace('export default backend;',
      "export default { port: 0, hostname: '127.0.0.1', fetch: backend.fetch };"));
    await (await createBuilder({ root, configFile: false, logLevel: 'silent',
      resolve: { preserveSymlinks: true },
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts', runtime: 'node' })] })).buildApp();
    expect(await readFile(join(root, 'dist/server.js'), 'utf8')).not.toMatch(/['"]@memoized-dom\/adapters(?:\/|['"])/);
    const production = spawn('node', [join(root, 'dist/server.js')], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    output = ''; errors = '';
    production.stdout.on('data', chunk => { output += chunk.toString(); });
    production.stderr.on('data', chunk => { errors += chunk.toString(); });
    try {
      await waitFor(() => expect(output, errors).toContain('http://'), 15_000);
      const origin = /http:\/\/[^\s]+/.exec(output)![0];
      expect(await (await fetch(origin + '/api/native')).json()).toMatchObject({ label: 'production', method: 'GET', node: expect.any(String) });
      const html = await (await fetch(origin)).text();
      expect(html).toContain('<h1>Before</h1>');
      expect(html).not.toContain('/@vite/client');
      const script = /<script[^>]+src="([^"]+)"/.exec(html)![1];
      expect((await fetch(origin + script)).headers.get('content-type')).toContain('javascript');
      expect(await (await fetch(origin + '/robots.txt')).text()).toBe('User-agent: *');
    } finally {
      production.kill();
      await new Promise<void>(done => production.exitCode !== null ? done() : production.once('exit', () => done()));
    }
  }, 45_000);

  it.each(['hono', 'serve'])('builds a movable %s backend with production SSR and assets without user installation', async kind => {
    const root = await project();
    if (kind === 'serve') await writeFile(join(root, 'server.ts'), `import { serve } from '@memoized-dom/server';
      import { App } from './src/App';
      import { define } from './server/define';
      const app = serve({ define }); app.ssr(App);
      app.get('/api/native', context => ({ label: 'before', bun: Bun.version, port: context.platform?.port }));
      export default app;`);
    const builder = await createBuilder({ root, configFile: false, logLevel: 'silent', base: '/demo/',
      // Installed packages are externalized by default. Keep their paths in
      // node_modules so this covers that case instead of workspace linking.
      resolve: { preserveSymlinks: true },
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts', runtime: 'bun' })] });
    await builder.buildApp();
    const moved = join(root, 'relocated');
    await cp(join(root, 'dist'), moved, { recursive: true });
    await rm(join(root, 'dist'), { recursive: true, force: true });
    expect(await readFile(join(moved, 'server.js'), 'utf8')).not.toMatch(/['"]@memoized-dom\/adapters(?:\/|['"])/);
    const { default: application } = await import(/* @vite-ignore */ pathToFileURL(join(moved, 'server.js')).href);
    const listener = Bun.serve({ port: 0, fetch: application.fetch });
    try {
      const origin = listener.url.origin;
      expect(await (await fetch(origin + '/api/native')).json()).toEqual({ label: 'before', bun: Bun.version, port: listener.port });
      expect(await (await fetch(origin + '/_fn/greeting/greeting?name=Ada')).json()).toEqual({ greeting: 'Hello Ada' });
      const html = await (await fetch(origin + '/demo/')).text();
      expect(html).toContain('<h1>Before</h1>');
      expect(html).not.toContain('/@vite/client');
      const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
      const css = /<link[^>]+href="([^"]+\.css)"/.exec(html)?.[1];
      expect(script).toStartWith('/demo/assets/');
      expect(css).toStartWith('/demo/assets/');
      const javascript = await fetch(origin + script);
      expect(javascript.status).toBe(200);
      expect(javascript.headers.get('content-type')).toContain('javascript');
      expect(await javascript.text()).not.toContain('<!doctype');
      expect((await fetch(origin + css)).headers.get('content-type')).toContain('text/css');
      expect(await (await fetch(origin + '/demo/robots.txt')).text()).toBe('User-agent: *');
      const head = await fetch(origin + script, { method: 'HEAD' });
      expect(head.status).toBe(200); expect(await head.text()).toBe('');
      expect((await fetch(origin + '/demo/assets/missing.js')).status).toBe(404);
      expect(await (await fetch(origin + '/demo/server.js')).text()).not.toBe(await readFile(join(moved, 'server.js'), 'utf8'));
    } finally { await listener.stop(true); }
  }, 60_000);
});
