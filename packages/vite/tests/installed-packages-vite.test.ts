import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { build, createServer, type ViteDevServer } from 'vite';
import { experimentalCompilePackage, experimentalFinalizePackage } from '@memoized-dom/compiler';
import puppeteer from 'puppeteer-core';
import memoizedDom from '../src';
import { closeBrowser } from '../../../test-support/browser';
import { waitFor } from '../../../test-support/helpers';

const repository = resolve(import.meta.dirname, '../../..');
const run = promisify(execFile);
let root: string, server: ViteDevServer | undefined;
const write = async (file: string, source: string) => {
  const path = join(root, file); await mkdir(dirname(path), { recursive: true }); await writeFile(path, source);
};
const config = () => ({ root, configFile: false as const, logLevel: 'silent' as const,
  plugins: [memoizedDom({ clientEntry: './main.ts', compilePackages: ['dset', 'throttle-debounce', 'counter-tools', 'conditional-tools'] })],
});
const chrome = [process.env.MMD_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium']
  .find((file): file is string => !!file && existsSync(file));
beforeEach(async () => {
  const parent = join(import.meta.dirname, 'fixtures/out'); await mkdir(parent, { recursive: true });
  root = await mkdtemp(join(parent, 'installed-vite-'));
  await write('package.json', '{"type":"module"}');
  for (const file of ['dist/index.mjs', 'merge/index.mjs']) await write('node_modules/dset/' + file,
    await readFile(join(repository, 'tests/fixtures/third-party/dset', file), 'utf8'));
  await write('node_modules/dset/package.json', JSON.stringify({ name: 'dset', version: '3.1.4',
    exports: { '.': './dist/index.mjs', './merge': './merge/index.mjs' } }));
  await write('node_modules/throttle-debounce/esm/index.js',
    await readFile(join(repository, 'tests/fixtures/third-party/throttle-debounce/esm/index.js'), 'utf8'));
  await write('node_modules/throttle-debounce/esm/package.json', '{"type":"module"}');
  await write('node_modules/throttle-debounce/package.json', JSON.stringify({ name: 'throttle-debounce', version: '5.0.2',
    exports: { '.': { import: './esm/index.js' } } }));
  await write('node_modules/counter-tools/package.json', JSON.stringify({ name: 'counter-tools', type: 'module', exports: './index.js' }));
  await write('node_modules/counter-tools/index.js', 'export function add(state){state.count+=1}');
  await write('node_modules/conditional-tools/package.json', JSON.stringify({ name: 'conditional-tools', exports: {
    '.': { browser: './browser.mjs', node: './server.mjs', default: './server.mjs' },
  } }));
  await write('node_modules/conditional-tools/browser.mjs', 'export function where(){return "browser"}');
  await write('node_modules/conditional-tools/server.mjs', 'export function where(){return "server"}');
  await write('index.html', '<!doctype html><body><div id="root"></div><script type="module" src="/main.ts"></script>');
  await write('main.ts', `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`);
  await write('App.tsx', `import {dset} from 'dset';import {dset as merge} from 'dset/merge';import {debounce} from 'throttle-debounce';
    import {add} from 'counter-tools';import {where} from 'conditional-tools';export function App(){const state={count:0,name:'before'};
      const later=debounce(25,async()=>{await Promise.resolve();state.count+=2;});$cleanup(()=>later.cancel());
      return <main><i id="environment">{where()}</i><output>{state.name}:{state.count}</output><input id="draft"/>
        <button id="change" onClick={()=>dset(state,'name','after')}>Change</button>
        <button id="merge" onClick={()=>merge(state,'name','merged')}>Merge</button>
        <button id="later" onClick={()=>later()}>Later</button><button id="add" onClick={()=>add(state)}>Add</button></main>;}`);
});
afterEach(async () => { await server?.close(); server = undefined; await rm(root, { recursive: true, force: true }); });

it('uses ordinary imports with automatic compilation in development and production', async () => {
  server = await createServer({ ...config(), server: { middlewareMode: true } });
  const transformed = await server.transformRequest('/App.tsx');
  expect(transformed!.code).toContain('memoized-dom-packages');
  expect(server.config.optimizeDeps.exclude).toContain('dset');
  expect(server.environments.ssr!.config.resolve.noExternal).toContain('dset');
  const source = await readFile(join(root, 'node_modules/dset/dist/index.mjs'), 'utf8');
  expect(source).toBe(await readFile(join(repository, 'tests/fixtures/third-party/dset/dist/index.mjs'), 'utf8'));
  await server.close(); server = undefined;
  const result = await build({ ...config(), build: { write: false } });
  const code = (Array.isArray(result) ? result : [result]).flatMap(output => 'output' in output ? output.output : [])
    .filter(file => file.type === 'chunk').map(file => file.code).join('\n');
  expect(code).not.toContain('node_modules/dset/dist/index.mjs');
  expect(code).not.toContain('memoized-dom-packages');
  expect(code).toContain('before');
  const cache = join(root, 'node_modules/.vite/memoized-dom-packages');
  expect((await readdir(cache)).length).toBeGreaterThanOrEqual(3);
}, 120_000);

it('honors Vite browser and server export conditions without falling back to require resolution', async () => {
  await write('server-check.ts', `import {dset} from 'dset';import {where} from 'conditional-tools';
    const state={name:'before'};dset(state,'name',where());export const result=state.name;`);
  server = await createServer({ ...config(), server: { middlewareMode: true } });
  const module = await server.ssrLoadModule('/server-check.ts');
  expect(module.result).toBe('server');
  const client = await server.transformRequest('/App.tsx');
  expect(client!.code).toContain('memoized-dom-packages');
}, 120_000);

it('supports the published plugin entry and persistent cache when Vite is launched by Node', async () => {
  await write('node-build.mjs', `import {build} from 'vite';
    import {memoizedDom} from ${JSON.stringify(pathToFileURL(join(repository, 'packages/vite/dist/index.js')).href)};
    for(let run=0;run<2;run++)await build({root:${JSON.stringify(root)},configFile:false,logLevel:'silent',
      plugins:[memoizedDom({clientEntry:'./main.ts',compilePackages:['dset','throttle-debounce','counter-tools','conditional-tools']})],
      build:{write:false}});console.log('NODE_CACHE_BUILD_OK');`);
  const result = await run('node', [join(root, 'node-build.mjs')], { cwd: root, windowsHide: true, timeout: 90_000 });
  expect(result.stdout).toContain('NODE_CACHE_BUILD_OK');
}, 120_000);

it('prefers an existing published artifact over opt-in recompilation', async () => {
  const packaged = experimentalCompilePackage({ './index.js': `export function add(state){state.count++;}
    export const extra={value:1};` }, {
    packageEntries: { 'aware-tools': { moduleId: './index.js', exports: ['add'] } },
  });
  const library = join(root, 'node_modules/aware-tools');
  await write('node_modules/aware-tools/package.json', JSON.stringify({ name: 'aware-tools', type: 'module', exports: './index.js',
    'memoized-dom': { artifact: './artifact.json', integrity: true } }));
  await write('node_modules/aware-tools/index.js', packaged.output['./index.js']!);
  await write('node_modules/aware-tools/artifact.json', JSON.stringify(await experimentalFinalizePackage(packaged.artifact, { packageRoot: library, outputDirectory: '.' })));
  await write('App.tsx', `import {add} from 'aware-tools';export function App(){const state={count:0};return <button onClick={()=>add(state)}>{state.count}</button>}`);
  server = await createServer({ ...config(), plugins: [memoizedDom({ clientEntry: './main.ts', compilePackages: ['aware-tools'] })],
    server: { middlewareMode: true } });
  expect((await server.transformRequest('/App.tsx'))!.code).not.toContain('memoized-dom-packages');
  expect(existsSync(join(root, 'node_modules/.vite/memoized-dom-packages'))).toBe(false);
}, 120_000);

it('rebuilds the matching cache and managed importer on a dependency edit inside node_modules', async () => {
  server = await createServer({ ...config(), server: { middlewareMode: true } });
  const initial = (await server.transformRequest('/App.tsx'))!.code;
  const originalCache = [...initial.matchAll(/memoized-dom-packages\/([a-f0-9]{64})/g)].map(match => match[1]);
  const changed = join(root, 'node_modules/counter-tools/index.js');
  const updated = Promise.withResolvers<void>();
  server.watcher.on('change', file => { if (file.replaceAll('\\', '/') === changed.replaceAll('\\', '/')) updated.resolve(); });
  await write('node_modules/counter-tools/index.js', 'export function add(state){state.count+=3}');
  await updated.promise;
  await waitFor(async () => {
    const code = (await server!.transformRequest('/App.tsx'))!.code;
    const next = [...code.matchAll(/memoized-dom-packages\/([a-f0-9]{64})/g)].map(match => match[1]);
    expect(next).not.toEqual(originalCache);
  }, { timeout: 30_000 });
}, 120_000);

it.skipIf(!chrome)('runs automatically compiled real packages in a production browser with retained DOM and drafts', async () => {
  await build({ ...config(), build: { minify: true } });
  const http = createHttpServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    try {
      const file = path === '/' ? 'index.html' : path.slice(1);
      response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
      response.end(await readFile(join(root, 'dist', file)));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${(http.address() as { port: number }).port}`);
    await page.waitForSelector('output');
    expect(await page.$eval('#environment', node => node.textContent)).toBe('browser');
    await page.evaluate(() => {
      const draft = document.querySelector<HTMLInputElement>('#draft')!; draft.value = 'keep';
      Object.assign(window, { retainedOutput: document.querySelector('output'), retainedDraft: draft });
    });
    await page.click('#change'); expect(await page.$eval('output', node => node.textContent)).toBe('after:0');
    await page.click('#merge'); expect(await page.$eval('output', node => node.textContent)).toBe('merged:0');
    await page.click('#later'); await page.waitForFunction(() => document.querySelector('output')?.textContent === 'merged:2');
    await page.click('#add'); await page.waitForFunction(() => document.querySelector('output')?.textContent === 'merged:3');
    expect(await page.evaluate(() => {
      const state = window as unknown as { retainedOutput: Node; retainedDraft: Node };
      return state.retainedOutput === document.querySelector('output') && state.retainedDraft === document.querySelector('#draft') &&
        document.querySelector<HTMLInputElement>('#draft')!.value === 'keep';
    })).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    try { if (browser) await closeBrowser(browser); } finally { await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve())); }
  }
}, 120_000);

it.skipIf(!chrome)('delivers dependency edits through development HMR to the actual browser', async () => {
  server = await createServer({ ...config(), server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`);
    await page.waitForSelector('#add');
    await page.click('#add'); await page.waitForFunction(() => document.querySelector('output')?.textContent === 'before:1');
    await page.evaluate(`import('/@vite/client').then(({createHotContext})=>{
      window.__originalDocument=true;window.__packageUpdated=false;
      createHotContext('/package-test-probe').on('vite:afterUpdate',()=>{window.__packageUpdated=true;});
    })`);
    await write('node_modules/counter-tools/index.js', 'export function add(state){state.count+=3}');
    await page.waitForFunction(`(window.__packageUpdated || !window.__originalDocument) && document.querySelector('#add') && document.querySelector('output')`);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const before = Number((await page.$eval('output', node => node.textContent))!.split(':')[1]);
    // Exactly one click must use the new implementation, not three old clicks.
    await page.click('#add');
    await page.waitForFunction(expected => document.querySelector('output')?.textContent === expected, {}, 'before:' + (before + 3));
    await page.evaluate('window.__packageUpdated=false');
    await write('node_modules/counter-tools/index.js', 'export function add( {');
    await page.waitForSelector('vite-error-overlay');
    // Repair to the exact previous bytes: a cache hit must still clear the
    // overlay and resume HMR rather than retain a failed-transform cache.
    await write('node_modules/counter-tools/index.js', 'export function add(state){state.count+=3}');
    await page.waitForFunction(`(window.__packageUpdated || !window.__originalDocument) && !document.querySelector('vite-error-overlay') && document.querySelector('#add') && document.querySelector('output')`);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const repaired = Number((await page.$eval('output', node => node.textContent))!.split(':')[1]);
    await page.click('#add');
    await page.waitForFunction(expected => document.querySelector('output')?.textContent === expected, {}, 'before:' + (repaired + 3));
  } finally { if (browser) await closeBrowser(browser); }
}, 120_000);
