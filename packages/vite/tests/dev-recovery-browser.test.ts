import { it, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { closeBrowser } from '../../../test-support/browser';
import memoizedDom from '../src';
import { createDevServer, type NativeDevServer } from '../src/dev';
import { waitFor } from '../../../test-support/helpers';

const chrome = [process.env.MMD_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium']
  .find((path): path is string => !!path && existsSync(path));
const app = `import {getBoard} from '#server-functions';export function App(){const board=getBoard();return <main><h1>Recovery</h1>{board}</main>}`;
const board = (label: string) => `export function Board(){return <section data-board>${label}</section>}`;
const backend = `import {ready} from './server/health';import {serve} from '@memoized-dom/server';import {define} from './server/define';import {App} from './src/App';if(!ready)throw new Error('Not ready');const app=serve({define});app.ssr(App);export default app;`;

async function project(): Promise<string> {
  const parent = resolve(import.meta.dirname, 'fixtures/out');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(resolve(parent, 'dev-recovery-'));
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/src/main.ts"></script></body></html>',
    'src/main.ts': `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`,
    'src/App.tsx': app,
    'server/Board.tsx': board('Before'),
    'server/health.ts': 'export const ready=true;',
    'server/define.ts': `import {createDefine} from '@memoized-dom/server';export const define=createDefine();export {page} from '@memoized-dom/server';`,
    'server/functions/boards.tsx': `import {define,page} from '../define';import {Board} from '../Board';export const getBoard=define.function({async get(){return page(<Board/>);}});`,
    'server.ts': backend,
  };
  for (const [file, source] of Object.entries(files)) {
    await mkdir(resolve(root, file, '..'), { recursive: true });
    await writeFile(resolve(root, file), source);
  }
  return root;
}

function start(root: string): Promise<NativeDevServer> {
  return createDevServer({ root, configFile: false, logLevel: 'silent',
    plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts' })],
    server: { host: '127.0.0.1', port: 0 } });
}

async function startNode(root: string): Promise<Pick<NativeDevServer, 'origin' | 'close'>> {
  await writeFile(resolve(root, 'launch.mjs'), `import {createDevServer} from '@memoized-dom/vite/dev';
    import memoizedDom from '@memoized-dom/vite';
    const dev=await createDevServer({root:import.meta.dirname,configFile:false,logLevel:'silent',
      plugins:[memoizedDom({clientEntry:'src/main.ts',serverEntry:'server.ts',runtime:'node'})],server:{host:'127.0.0.1',port:0}});
    console.log(JSON.stringify({origin:dev.origin}));
    process.on('SIGTERM',async()=>{await dev.close();process.exit(0)});`);
  const child = spawn('node', [resolve(root, 'launch.mjs')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', data => { output += data.toString(); });
  child.stderr.on('data', data => { errors += data.toString(); });
  const exited = new Promise<void>(done => child.once('exit', () => done()));
  const close = async () => { child.kill(); await exited; };
  try {
    // A fresh fixture re-optimizes dependencies on every start: 8–18s on a busy machine.
    await waitFor(() => expect(output, errors).toContain('"origin"'), { timeout: 60_000, interval: 100 });
    return { origin: (JSON.parse(output.trim()) as { origin: string }).origin, close };
  } catch (error) { await close(); throw error; }
}

it.skipIf(!chrome).each(['identical', 'changed'] as const)('keeps working server pages through a syntax error and recovers after an %s repair', async repair => {
  const root = await project();
  let dev: NativeDevServer | undefined;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  try {
    dev = await start(root);
    const page = await browser.newPage();
    await page.goto(dev.origin, { waitUntil: 'networkidle0' });
    await page.evaluate(() => { document.documentElement.dataset.recoveryProbe = 'kept'; });
    await writeFile(resolve(root, 'server/Board.tsx'), 'export function Board(){return <section>');
    await page.waitForSelector('vite-error-overlay', { timeout: 15_000 });
    expect(await page.$eval('[data-board]', element => element.textContent)).toBe('Before');
    expect(await page.evaluate(() => document.documentElement.dataset.recoveryProbe)).toBe('kept');
    const navigation = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20_000 });
    await writeFile(resolve(root, 'server/Board.tsx'), board(repair === 'identical' ? 'Before' : 'After'));
    await navigation;
    try {
      await page.waitForFunction(label => document.querySelector('[data-board]')?.textContent === label && !document.querySelector('vite-error-overlay'),
        { timeout: 15_000 }, repair === 'identical' ? 'Before' : 'After');
    } catch (error) { throw new Error(String(error) + '\n' + await page.content()); }
    expect(await page.evaluate(() => document.documentElement.dataset.recoveryProbe)).toBeUndefined();
  } finally { await closeBrowser(browser); await dev?.close(); await rm(root, { recursive: true, force: true }); }
}, 90_000);

it.skipIf(!chrome).each([['bun', 'throw'], ['node', 'throw'], ['bun', 'missing'], ['node', 'missing']] as const)(
  'recovers a failed document on %s after a server-only %s repair', async (runtime, failure) => {
  const root = await project();
  let dev: Pick<NativeDevServer, 'origin' | 'close'> | undefined;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  try {
    dev = runtime === 'bun' ? await start(root) : await startNode(root);
    const page = await browser.newPage();
    await page.goto(dev.origin, { waitUntil: 'networkidle0' });
    // Import-time failures happen before the backend can proxy even Vite assets.
    if (failure === 'missing') {
      await rm(resolve(root, 'server/health.ts'));
      // An already imported dependency can remain usable until another edit
      // makes the host import a replacement backend during the rebuild gap.
      await writeFile(resolve(root, 'server.ts'), backend + '\nexport const rebuilding=true;');
    }
    else await writeFile(resolve(root, 'server.ts'), backend.replace('export default app;', "throw new Error('Broken backend import');export default app;"));
    await waitFor(async () => {
      const response = await fetch(dev!.origin, { headers: { accept: 'text/html' } });
      await response.body?.cancel();
      expect(response.status).toBe(500);
    }, { timeout: 15_000, interval: 100 });
    const failed = await page.reload({ waitUntil: 'networkidle0' });
    expect(failed?.status()).toBe(500);
    await page.waitForSelector('vite-error-overlay', { timeout: 15_000 });
    expect(await page.title()).toBe('Development error');
    const navigation = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20_000 });
    if (failure === 'missing') await writeFile(resolve(root, 'server/health.ts'), 'export const ready=true;');
    else await writeFile(resolve(root, 'server.ts'), backend);
    await navigation;
    try { await page.waitForSelector('[data-board]', { timeout: 15_000 }); }
    catch (error) { throw new Error(String(error) + '\n' + await page.content()); }
    expect(await page.$eval('[data-board]', element => element.textContent)).toBe('Before');
    expect(await page.$('vite-error-overlay')).toBeNull();
  } finally { await closeBrowser(browser); await dev?.close(); await rm(root, { recursive: true, force: true }); }
}, 150_000);

it.skipIf(!chrome)('repairs an ordinary component syntax error even when the original source is restored', async () => {
  const root = await project();
  let dev: NativeDevServer | undefined;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  try {
    dev = await start(root);
    const page = await browser.newPage();
    await page.goto(dev.origin, { waitUntil: 'networkidle0' });
    await writeFile(resolve(root, 'src/App.tsx'), 'export function App(){return <main>');
    await page.waitForSelector('vite-error-overlay', { timeout: 15_000 });
    expect(await page.$eval('h1', element => element.textContent)).toBe('Recovery');
    await writeFile(resolve(root, 'src/App.tsx'), app);
    await page.waitForFunction(() => !document.querySelector('vite-error-overlay') && document.querySelector('[data-board]')?.textContent === 'Before', { timeout: 20_000 });
    expect(await page.$eval('h1', element => element.textContent)).toBe('Recovery');
  } finally { await closeBrowser(browser); await dev?.close(); await rm(root, { recursive: true, force: true }); }
}, 90_000);

it('keeps slow development document requests alive beyond the default Bun idle timeout', async () => {
  const root = await project();
  let dev: NativeDevServer | undefined;
  try {
    await writeFile(resolve(root, 'server.ts'), `export default {async fetch(){await Bun.sleep(11_000);return new Response('Ready')}};`);
    dev = await start(root);
    const response = await fetch(dev.origin, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(25_000) });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Ready');
  } finally { await dev?.close(); await rm(root, { recursive: true, force: true }); }
}, 45_000);
