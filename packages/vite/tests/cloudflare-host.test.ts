import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { waitFor } from '../../../test-support/helpers';

const fetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, { ...init, signal: AbortSignal.timeout(15_000) });

let fixture: string | undefined;
let child: ChildProcess | undefined;
let childErrors = '';
let childOutput = '';
afterEach(async () => {
  if (child) {
    child.kill();
    await new Promise<void>(done => child!.exitCode !== null || child!.signalCode !== null ? done() : child!.once('exit', () => done()));
  }
  child = undefined;
  if (fixture) await rm(fixture, { recursive: true, force: true });
  fixture = undefined;
}, 30_000);

const component = (label: string) => `export function App() { let count = 0;
  return <main><h1>${label}</h1><button onClick={() => count++}>{count}</button></main>; }`;
const backend = (label: string, kind = 'hono') => `import { Hono } from 'hono';
${kind === 'worker' ? "import assetUrl from './worker-image.svg?url';" : ''}
import { serve } from '@memoized-dom/server'; import { App } from './src/App';
import { define } from './server/define';
const app = serve({ define, onError(error) { console.error(error); return new Response(String(error), { status: 500 }); } }); app.ssr(App);
${kind === 'serve' ? `app.get('/api/native', c => ({ label: '${label}', message: c.platform.env.MESSAGE,
  worker: typeof WebSocketPair, bun: typeof Bun, context: typeof c.platform.executionCtx.waitUntil }));
export default app;` : `const backend = new Hono();
backend.get('/api/native', c => {
  c.executionCtx.waitUntil(c.env.STORE.put('ready', '${label}'));
  return c.json({ label: '${label}', message: c.env.MESSAGE, worker: typeof WebSocketPair,
    bun: typeof Bun, context: typeof c.executionCtx.waitUntil });
});
${kind === 'worker' ? "backend.get('/api/worker-asset', c => c.text(assetUrl));" : ''}
backend.get('/api/stored', async c => c.text(await c.env.STORE.get('ready') ?? 'missing'));
backend.all('*', c => app.fetch(c.req.raw, { platform: { env: c.env, executionCtx: c.executionCtx } }));
${kind === 'worker' ? `export default { fetch: (request, env, ctx) => backend.fetch(request, env, ctx),
  scheduled(_event, env, ctx) { ctx.waitUntil(env.STORE.put('scheduled', 'yes')); } };` : 'export default backend;'}`}`;

async function project(kind = 'hono') {
  const parent = resolve(import.meta.dirname, 'fixtures/out');
  await mkdir(parent, { recursive: true });
  fixture = await mkdtemp(join(parent, 'cloudflare-host-'));
  await mkdir(join(fixture, 'src'));
  await mkdir(join(fixture, 'server/functions'), { recursive: true });
  await mkdir(join(fixture, 'public'));
  await writeFile(join(fixture, 'index.html'), '<!doctype html><html><head><title>Worker</title></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/src/main.ts"></script></body></html>');
  await writeFile(join(fixture, 'src/main.ts'), `import './style.css'; import { mount } from '@memoized-dom/runtime'; import { App } from './App'; mount('root', App);`);
  await writeFile(join(fixture, 'src/style.css'), 'h1 { color: rgb(12, 34, 56); }');
  await writeFile(join(fixture, 'src/App.tsx'), component('Before'));
  await writeFile(join(fixture, 'server/define.ts'), `import { createDefine } from '@memoized-dom/server';
export const define = createDefine<Record<string, never>, { env: any; executionCtx: any }>();`);
  await writeFile(join(fixture, 'server.ts'), backend('before', kind));
  await writeFile(join(fixture, 'public/robots.txt'), 'User-agent: *');
  await writeFile(join(fixture, 'worker-image.svg'), '<svg xmlns="http://www.w3.org/2000/svg">' + '<rect width="1" height="1"/>'.repeat(300) + '</svg>');
  await writeFile(join(fixture, 'server/functions/greeting.ts'), `import { define } from '../define';
export const greeting = define.function({ get: async (context, name: string) => {
  await new Promise(done => setTimeout(done, name === 'first' ? 20 : 0));
  return { greeting: 'Hello ' + name, message: context.platform.env.MESSAGE, user: context.request.headers.get('x-user') };
} });`);
  await writeFile(join(fixture, 'launch.mjs'), `const { createDevServer } = await import('@memoized-dom/vite/dev');
const { default: memoizedDom } = await import('@memoized-dom/vite');
const { cloudflare } = await import('@memoized-dom/vite/cloudflare');
const { createBuilder, preview } = await import('vite');
const config = { root: import.meta.dirname, configFile: false, logLevel: 'error', cacheDir: '.vite',
  base: ${JSON.stringify(kind === 'worker' ? '/demo/' : '/')},
  plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts', runtime: 'cloudflare' }),
    cloudflare({ config: { name: 'memoized-worker', compatibility_date: '2026-09-01', vars: { MESSAGE: 'binding' }, assets: { binding: ${JSON.stringify(kind === 'worker' ? 'STATIC' : 'ASSETS')} },
      kv_namespaces: [{ binding: 'STORE', id: '00000000000000000000000000000000' }] },
      inspectorPort: false, persistState: false, remoteBindings: false })],
  server: { host: '127.0.0.1', port: 0 }, preview: { host: '127.0.0.1', port: 0 } };
let server;
if (process.argv[2] === 'production') {
  await (await createBuilder(config)).buildApp();
  server = await preview(config);
  console.log(JSON.stringify({ origin: new URL(server.resolvedUrls.local[0]).origin, runtime: 'cloudflare' }));
} else {
  server = await createDevServer(config);
  console.log(JSON.stringify({ origin: server.origin, runtime: server.runtime }));
}
process.once('SIGTERM', async () => { await (server.close ? server.close() : new Promise(done => server.httpServer.close(done))); process.exit(0); });`);
  return fixture;
}

async function start(root: string, mode = 'development'): Promise<string> {
  childErrors = '';
  childOutput = '';
  child = spawn('node', [join(root, 'launch.mjs'), mode], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  let output = '', errors = '';
  child.stdout!.on('data', chunk => { output += chunk.toString(); childOutput += chunk.toString(); });
  child.stderr!.on('data', chunk => { errors += chunk.toString(); childErrors += chunk.toString(); });
  await waitFor(() => {
    if (child!.exitCode !== null || child!.signalCode !== null) throw new Error('Worker host exited: ' + output + errors);
    if (!output.includes('"origin"')) throw new Error('Waiting for Worker host: ' + output + errors.slice(-12_000));
  }, 120_000);
  const details = JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{"origin"'))!);
  expect(details.runtime).toBe('cloudflare');
  return details.origin;
}

describe('Cloudflare Worker host', () => {
  it('executes Hono and SSR in workerd with real bindings, concurrent contexts, and server HMR', async () => {
    const root = await project();
    const origin = await start(root);
    expect(await (await fetch(origin + '/api/native')).json()).toEqual({ label: 'before', message: 'binding', worker: 'function', bun: 'undefined', context: 'function' });
    await waitFor(async () => expect(await (await fetch(origin + '/api/stored')).text()).toBe('before'), 10_000);
    const initialPage = await fetch(origin);
    if (!initialPage.ok) throw new Error(await initialPage.text() + '\n' + (childErrors + childOutput).slice(-12_000));
    expect(await initialPage.text()).toContain('<h1>Before</h1>');
    expect((await fetch(origin + '/src/main.ts')).headers.get('content-type')).toContain('javascript');
    const replies = await Promise.all(['first', 'second'].map(name => fetch(origin + '/_fn/greeting/greeting?name=' + name,
      { headers: { 'x-user': name } }).then(response => response.json())));
    expect(replies).toEqual(['first', 'second'].map(name => ({ greeting: 'Hello ' + name, message: 'binding', user: name })));
    await writeFile(join(root, 'server.ts'), backend('after'));
    await waitFor(async () => expect(await (await fetch(origin + '/api/native')).json()).toMatchObject({ label: 'after' }), 15_000);
    const functionFile = join(root, 'server/functions/greeting.ts');
    await writeFile(functionFile, (await readFile(functionFile, 'utf8')).replace("'Hello '", "'Welcome '"));
    await waitFor(async () => expect(await (await fetch(origin + '/_fn/greeting/greeting?name=Ada')).json())
      .toMatchObject({ greeting: 'Welcome Ada', message: 'binding' }), 15_000);
    await writeFile(join(root, 'src/App.tsx'), component('After'));
    await waitFor(async () => expect(await (await fetch(origin)).text()).toContain('<h1>After</h1>'), 15_000);
    const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
    if (chrome) {
      const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(origin, { waitUntil: 'networkidle0' });
        await page.click('button');
        expect(await page.$eval('button', node => node.textContent)).toBe('1');
        await page.evaluate(() => { document.documentElement.dataset.marker = 'retained'; });
        await writeFile(join(root, 'src/App.tsx'), component('Browser update'));
        await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Browser update');
        expect(await page.evaluate(() => document.documentElement.dataset.marker)).toBe('retained');
      } finally { await browser.close(); }
    }
  }, 180_000);

  it.each(['hono', 'serve', 'worker'])('builds and previews a native %s Worker with automatic SSR and client assets', async kind => {
    const root = await project(kind);
    const origin = await start(root, 'production');
    expect(await (await fetch(origin + '/api/native')).json()).toMatchObject({ label: 'before', message: 'binding', worker: 'function', bun: 'undefined', context: 'function' });
    const html = await (await fetch(origin)).text();
    expect(html).toContain('<h1>Before</h1>');
    expect(html).not.toContain('/@vite/client');
    const script = /<script[^>]+src="([^"]+)"/.exec(html)![1];
    expect((await fetch(origin + script)).headers.get('content-type')).toContain('javascript');
    expect((await fetch(origin + script, { method: 'HEAD' })).status).toBe(200);
    expect(await (await fetch(origin + (kind === 'worker' ? '/demo/' : '/') + 'robots.txt')).text()).toBe('User-agent: *');
    expect((await fetch(origin + (kind === 'worker' ? '/demo/' : '/') + 'assets/missing.js')).status).toBe(404);
    expect(await (await fetch(origin + '/_fn/greeting/greeting?name=Ada', { headers: { 'x-user': 'Ada' } })).json())
      .toEqual({ greeting: 'Hello Ada', message: 'binding', user: 'Ada' });
    const config = JSON.parse(await readFile(join(root, 'dist/ssr/wrangler.json'), 'utf8'));
    expect(config.assets.binding).toBe(kind === 'worker' ? 'STATIC' : 'ASSETS');
    if (kind === 'worker') {
      const url = await (await fetch(origin + '/api/worker-asset')).text();
      expect(url).toMatch(/^\/demo\/assets\/worker-image-/);
      expect(await (await fetch(origin + url)).text()).toContain('<svg');
    }
    expect(config.assets.run_worker_first).toBe(true);
  }, 180_000);
});
