import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { afterEach, describe, expect, it } from 'bun:test';
import { waitFor } from '../../../test-support/helpers';

const repository = resolve(import.meta.dirname, '../../..');
const cli = join(repository, 'packages/vite/dist/cli.js');
const plugin = pathToFileURL(join(repository, 'packages/vite/dist/index.js')).href;
const workerPlugin = pathToFileURL(join(repository, 'packages/vite/dist/cloudflare.js')).href;
const chrome = [process.env.MMD_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium']
  .find((path): path is string => !!path && existsSync(path));
let fixture: string | undefined;
let child: ChildProcess | undefined;

afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = new Promise<void>(done => child!.once('exit', () => done()));
    if (process.platform === 'win32') {
      // Only this test's process tree; the CLI can own a native-runtime child.
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      await new Promise<void>(done => killer.once('exit', () => done()));
    } else child.kill('SIGTERM');
    await stopped;
  }
  child = undefined;
  if (fixture) await rm(fixture, { recursive: true, force: true });
  fixture = undefined;
});

async function project(runtime: 'bun' | 'node' | 'cloudflare' | 'browser'): Promise<string> {
  const parent = join(import.meta.dirname, 'fixtures/out');
  await mkdir(parent, { recursive: true });
  fixture = await mkdtemp(join(parent, 'cli-'));
  await mkdir(join(fixture, 'src'));
  await writeFile(join(fixture, 'src/main.ts'), `import { mount } from '@memoized-dom/runtime';
    import { App } from './App'; mount('root', App);`);
  await writeFile(join(fixture, 'src/App.tsx'), 'export function App() { return <h1>CLI fixture</h1>; }');
  await writeFile(join(fixture, 'index.html'), '<!doctype html><title>CLI fixture</title><div id="root"><!--ssr-outlet--></div><script type="module" src="/src/main.ts"></script>');
  await writeFile(join(fixture, 'server.ts'), `import { createDefine, serve } from '@memoized-dom/server';
    import { App } from './src/App';
    const app = serve({ define: createDefine() });
    app.get('/api/native', ({ platform }) => ({
        runtime: typeof WebSocketPair !== 'undefined' ? 'cloudflare' : typeof Bun !== 'undefined' ? 'bun' : 'node',
        nativePort: platform?.port ?? null,
        nativeMethod: platform?.incoming?.method ?? null,
    }));
    app.ssr(App);
    export default app;`);
  await writeFile(join(fixture, 'vite.config.mts'), `
    import memoizedDom from ${JSON.stringify(plugin)};
    ${runtime === 'cloudflare' ? `import { cloudflare } from ${JSON.stringify(workerPlugin)};` : ''}
    export default {
      root: import.meta.dirname, logLevel: 'error',
      plugins: [memoizedDom({ clientEntry: 'src/main.ts',
        ${runtime === 'browser' ? '' : `serverEntry: 'server.ts', runtime: '${runtime}',`}
      }), ${runtime === 'cloudflare' ? `cloudflare({ config: { name: 'cli-fixture', compatibility_date: '2026-09-01' },
        inspectorPort: false, persistState: false, remoteBindings: false })` : ''}],
      server: { host: '127.0.0.1', port: 0 },
    };
  `);
  return fixture;
}

function launch(caller: 'bun' | 'node', root: string, args: string[] = []): { output: () => string; errors: () => string } {
  child = spawn(caller, [cli, ...args], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  let output = '', errors = '';
  child.stdout!.on('data', chunk => { output += chunk.toString(); });
  child.stderr!.on('data', chunk => { errors += chunk.toString(); });
  child.on('error', error => { errors += String(error); });
  return { output: () => output, errors: () => errors };
}

async function origin(log: ReturnType<typeof launch>, runtime: string): Promise<string> {
  let address = '';
  await waitFor(() => {
    const match = log.output().match(new RegExp(`Memoized DOM \\(${runtime}\\): (http[^\\s]+)`));
    expect(match, log.output() + log.errors()).not.toBeNull();
    address = match![1]!;
  }, runtime === 'cloudflare' ? 90_000 : 60_000);
  return address;
}

describe('consistent CLI launcher', () => {
  it.each(['node', 'cloudflare'] as const)('streams declared queries and generator functions on %s', async runtime => {
    const root = await project(runtime);
    await mkdir(join(root, 'server/functions'), { recursive: true });
    await writeFile(join(root, 'server/define.ts'), `import { createDefine } from '@memoized-dom/server'; export const define = createDefine();`);
    await writeFile(join(root, 'server/functions/live.ts'), `import { define } from '../define';
      let count = 0;
      export const getCount = define.function({ live: () => ['count'], async get() { return count; } });
      export const increment = define.function({ updates: () => ['count'], async post() { return ++count; } });
      export const answer = define.function({ async *post() { yield 'a'; yield 'ab'; return 'ignored'; } });`);
    await writeFile(join(root, 'server.ts'), `import { createDefine, serve } from '@memoized-dom/server';
      import { define } from './server/define'; import { App } from './src/App';
      const app = serve({ define }); app.ssr(App); export default app;`);
    const log = launch('node', root, ['dev']);
    const address = await origin(log, runtime);
    const response = await fetch(address + '/_fn/live/getCount', { headers: { 'x-mmd-stream': 'live' }, signal: AbortSignal.timeout(20_000) });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const nextValue = async () => {
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary !== -1) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          if (!frame.startsWith('event: value')) continue;
          return JSON.parse(frame.split('\n')[1]!.slice(6)).value as number;
        }
        const part = await reader.read();
        if (part.done) throw new Error('Unexpected stream end');
        buffer += decoder.decode(part.value, { stream: true });
      }
    };
    try {
      expect(await nextValue()).toBe(0);
      const result = await fetch(address + '/_fn/live/increment', { method: 'POST' });
      expect(await result.json()).toBe(1);
      expect(result.headers.has('x-mmd-updates')).toBe(true);
      expect(await nextValue()).toBe(1);
    } finally { await reader.cancel(); }
    const generated = await fetch(address + '/_fn/live/answer', { method: 'POST', headers: { 'x-mmd-stream': 'generator' }, signal: AbortSignal.timeout(10_000) });
    const events = await generated.text();
    expect(events).toContain('"value":"a"'); expect(events).toContain('"value":"ab"');
    expect(events).toContain('event: done'); expect(events).not.toContain('ignored');
  }, 120_000);

  it.skipIf(!chrome)('hydrates routed source caches as arrays and reuses them after browser navigation', async () => {
    const root = await project('bun');
    await mkdir(join(root, 'server/functions'), { recursive: true });
    await writeFile(join(root, 'server/define.ts'), `import { createDefine } from '@memoized-dom/server'; export const define = createDefine();`);
    await writeFile(join(root, 'server/functions/items.ts'), `import { define } from '../define';
      export const getExpeditions = define.function({ async get() { return [{ id: 'one', name: 'First' }]; } });`);
    await writeFile(join(root, 'src/App.tsx'), `import { getExpeditions } from '#server-functions';
      export function App() {
        return <main>
          <nav><a data-items route-to="/items">Items</a><a data-other route-to="/other">Other</a></nav>
          <List route="/items" /><p data-other-page route="/other">Other page</p>
        </main>;
      }
      function List() {
        const expeditions = $routed(({ routeState }) => {
          if (routeState.expeditions) return routeState.expeditions;
          const result = getExpeditions();
          routeState.expeditions = result;
          return result;
        });
        return <ul data-items-list>{expeditions.map(e => <li>{e.name}</li>)}</ul>;
      }`);
    const log = launch('node', root, ['dev']);
    const address = await origin(log, 'bun');
    const html = await (await fetch(address + '/items')).text();
    expect(html).toContain('<li>First</li>');
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      const requests: string[] = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('request', request => { if (request.url().includes('/_fn/items/getExpeditions')) requests.push(request.url()); });
      await page.goto(address + '/items', { waitUntil: 'networkidle0' });
      expect(await page.$eval('[data-items-list]', element => element.textContent)).toBe('First');
      for (let visit = 0; visit < 2; visit++) {
        await page.click('[data-other]');
        await page.waitForSelector('[data-other-page]');
        await page.click('[data-items]');
        await page.waitForSelector('[data-items-list]');
        expect(await page.$eval('[data-items-list]', element => element.textContent)).toBe('First');
      }
      expect(errors).toEqual([]);
      expect(requests).toEqual([]);
    } finally { await browser.close(); }
  }, 90_000);

  it.each([['node', 'bun'], ['bun', 'node'], ['node', 'node'], ['bun', 'bun']] as const)(
    'honors configured runtime when launched by %s for %s', async (caller, runtime) => {
      const root = await project(runtime);
      const log = launch(caller, root, ['dev', '--config', 'vite.config.mts', '--port', '0']);
      const address = await origin(log, runtime);
      const response = await fetch(address + '/api/native');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        runtime,
        nativePort: runtime === 'bun' ? Number(new URL(address).port) : null,
        nativeMethod: runtime === 'node' ? 'GET' : null,
      });
    }, 90_000,
  );

  it('uses the same dev command for browser-only projects and discovers their config', async () => {
    const root = await project('browser');
    const log = launch('bun', root, ['dev']);
    const address = await origin(log, 'browser');
    expect(await (await fetch(address)).text()).toContain('<title>CLI fixture</title>');
    expect((await fetch(address + '/src/main.ts')).status).toBe(200);
  }, 90_000);

  it('hands a Bun invocation to Node tooling for real Cloudflare Workers', async () => {
    const root = await project('cloudflare');
    const log = launch('bun', root, ['dev']);
    const address = await origin(log, 'cloudflare');
    expect(await (await fetch(address + '/api/native')).json()).toMatchObject({ runtime: 'cloudflare' });
  }, 120_000);

  it('builds with the same command and forwards build failures', async () => {
    const root = await project('browser');
    const log = launch('bun', root, ['build']);
    await waitFor(() => expect(child!.exitCode, log.output() + log.errors()).toBe(0), 30_000);
    expect(await readFile(join(root, 'dist/index.html'), 'utf8')).toContain('CLI fixture');
    await writeFile(join(root, 'vite.config.mts'), 'throw new Error("Deliberate config failure");');
    const failed = launch('bun', root, ['build']);
    await waitFor(() => expect(child!.exitCode, failed.output() + failed.errors()).toBe(1), 30_000);
    expect(failed.errors()).toContain('Deliberate config failure');
  }, 90_000);
});
