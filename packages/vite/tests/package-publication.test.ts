import { afterEach, expect, it } from 'bun:test';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createBuilder } from 'vite';
import puppeteer from 'puppeteer-core';
import { experimentalCompilePackage } from '@memoized-dom/compiler';
import memoizedDom from '../src';
import { createDevServer, type NativeDevServer } from '../src/dev';
import { discoverPackageArtifact } from '../src/graph/package-artifacts';

const run = promisify(execFile);
const repository = resolve(import.meta.dirname, '../../..');
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc');
const chrome = [process.env.MMD_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium']
  .find((path): path is string => !!path && existsSync(path));
let fixture: string | undefined;
let dev: NativeDevServer | undefined;
let host: ReturnType<typeof Bun.serve> | undefined;

afterEach(async () => {
  await dev?.close(); dev = undefined;
  await host?.stop(true); host = undefined;
  if (fixture) await rm(fixture, { recursive: true, force: true });
  fixture = undefined;
});

async function files(root: string, entries: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(entries)) {
    const file = join(root, name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
}

it('consumes a packed, minified component/helper library without its source in types, dev, production and SSR', async () => {
  fixture = await mkdtemp(join(tmpdir(), 'mmd-package-publication-'));
  const producer = join(fixture, 'library'), consumer = join(fixture, 'consumer');
  // Use the matching built framework, as workspace applications do. Only the
  // library under test is packed/installed; it has no aliases or source links.
  const scope = join(fixture, 'node_modules/@memoized-dom');
  await mkdir(scope, { recursive: true });
  for (const name of ['runtime', 'data', 'router', 'server', 'compiler', 'adapters']) {
    await symlink(join(repository, 'packages', name), join(scope, name), process.platform === 'win32' ? 'junction' : 'dir');
  }
  const modules = {
    './index.ts': `export {Badge,Unused} from './badge';export {add} from './helpers';`,
    './badge.tsx': `export function Badge({value,onPress}:{value:number;onPress:()=>void}){
      return <section class="badge"><button class="package-button" onClick={onPress}>{value}</button>
        <main><slot><em>Package fallback</em><input class="package-draft"/></slot></main></section>;
      }
      export function Unused(){return <aside>UNUSED_PACKAGE_EXPORT_SENTINEL</aside>;}`,
    './helpers.ts': `export function add(counter:{value:number},amount:number):void{counter.value+=amount;}`,
    './status.ts': `import {$track,type ResolvedValue} from '@memoized-dom/data';
      export function waiting<T>(source:ResolvedValue<T>):boolean{return $track(source).refreshing;}`,
  };
  await files(producer, Object.fromEntries(Object.entries(modules).map(([name, source]) => ['src/' + name.slice(2), source])));
  const compiled = experimentalCompilePackage(modules, { packageEntries: {
    '@publication/ui': './index.ts', '@publication/ui/status': './status.ts',
  } });
  expect(compiled.artifact.entries['@publication/ui']!.components!.Badge!.initial?.adoption).toBe('host-slots-v2');
  await files(producer, Object.fromEntries(Object.entries(compiled.output).map(([name, source]) => ['compiled/' + name.slice(2), source])));
  await files(producer, {
    'package.json': JSON.stringify({ name: '@publication/ui', version: '0.0.0', type: 'module', sideEffects: false, files: ['dist'],
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' }, './status': { types: './dist/status.d.ts', import: './dist/status.js' } },
      peerDependencies: { '@memoized-dom/runtime': '*', '@memoized-dom/data': '*' },
      'memoized-dom': { artifact: './dist/memoized-dom.package.json' },
    }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'Preserve', moduleResolution: 'Bundler',
      jsx: 'preserve', strict: true, skipLibCheck: true, types: ['@memoized-dom/compiler/jsx'],
      declaration: true, emitDeclarationOnly: true, rootDir: './src', outDir: './dist' }, include: ['src'] }),
  });
  // Declaration generation is separate from the consumer's Bun typecheck.
  await run('node', [tsc, '-p', 'tsconfig.json'], { cwd: producer, windowsHide: true, timeout: 30_000 });
  const bundled = await Bun.build({ entrypoints: ['index.ts', 'status.ts'].map(name => join(producer, 'compiled', name)),
    outdir: join(producer, 'dist'), target: 'browser', format: 'esm', minify: true, external: ['@memoized-dom/*'] });
  expect(bundled.success, bundled.logs.map(String).join('\n')).toBe(true);
  await writeFile(join(producer, 'dist/memoized-dom.package.json'), JSON.stringify(compiled.artifact));
  const tarball = join(fixture, 'publication-ui.tgz');
  await run(process.execPath, ['pm', 'pack', '--ignore-scripts', '--filename', tarball], { cwd: producer, windowsHide: true, timeout: 30_000 });
  await files(consumer, {
    'package.json': JSON.stringify({ name: 'publication-consumer', private: true, type: 'module', dependencies: {
      '@publication/ui': 'file:../publication-ui.tgz', '@memoized-dom/runtime': 'workspace:*', '@memoized-dom/data': 'workspace:*',
    } }),
    'index.html': '<!doctype html><html><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/main.ts"></script></body></html>',
    'main.ts': `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`,
    'ui.ts': `export {Badge as Card,add} from '@publication/ui';export {waiting as busy} from '@publication/ui/status';`,
    'App.tsx': `import {Card,add,busy} from './ui';
      export function App(){let counter={value:1};let shown=true;const items=$fetch<{id:number}[]>('/api/items');const loading=busy(items);
        return <article><Card value={counter.value} onPress={()=>add(counter,2)}/>
          <button class="toggle" onClick={()=>shown=!shown}>Toggle</button>
          {shown&&<Card value={counter.value} onPress={()=>add(counter,2)}><i>Caller content</i></Card>}
          <output>{counter.value}</output><p class="request">{loading?'Refreshing':items.length+' ready'}</p>
          <p class="item">{items[0]?.id}</p><button class="refresh" onClick={()=>$track(items).refresh()}>Refresh</button>
        </article>;}`,
    'server.ts': `import {createDefine,serve} from '@memoized-dom/server';import {App} from './App';let reads=0;const reports=[];
      const app=serve({define:createDefine(),onRender:report=>reports.push({outcome:report.outcome,error:report.error?.stack})});
      app.get('/__reports',()=>reports);app.get('/api/items',async()=>{await new Promise(done=>setTimeout(done,400));return [{id:++reads}];});app.ssr(App);export default app;`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'Preserve', moduleResolution: 'Bundler',
      jsx: 'preserve', strict: true, skipLibCheck: true, noEmit: true, types: ['@memoized-dom/compiler/jsx'] }, include: ['App.tsx', 'types.test.tsx'] }),
    'types.test.tsx': `import {Badge,add} from '@publication/ui';import {waiting} from '@publication/ui/status';
      const element:JSX.Element=<Badge value={1} onPress={()=>{}}/>;
      const state:boolean=waiting($fetch<{id:number}[]>('/api/items'));add({value:1},2);void element;void state;
      // @ts-expect-error request helpers retain their source contract
      waiting([{id:1}]);
      // @ts-expect-error published props remain typed
      const bad=<Badge value="wrong" onPress={()=>{}}/>;void bad;
      // @ts-expect-error published helper arguments remain typed
      add({value:'wrong'},2);`,
  });
  await files(fixture, { 'package.json': JSON.stringify({ name: 'publication-workspace', private: true, workspaces: ['consumer', 'framework/*'] }) });
  for (const name of ['runtime', 'data']) {
    const member = join(fixture, 'framework', name);
    await files(member, { 'package.json': await readFile(join(repository, 'packages', name, 'package.json'), 'utf8') });
    await symlink(join(repository, 'packages', name, 'dist'), join(member, 'dist'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  await run(process.execPath, ['install', '--offline', '--ignore-scripts', '--cache-dir', join(fixture, 'cache')],
    { cwd: consumer, windowsHide: true, timeout: 30_000 });
  await mkdir(scope, { recursive: true });
  for (const name of ['router', 'server', 'compiler', 'adapters']) {
    if (!existsSync(join(scope, name))) await symlink(join(repository, 'packages', name), join(scope, name), process.platform === 'win32' ? 'junction' : 'dir');
  }
  const installed = dirname(dirname(Bun.resolveSync('@publication/ui', consumer)));
  expect(existsSync(join(installed, 'dist/index.js'))).toBe(true);
  expect(existsSync(join(installed, 'dist/memoized-dom.package.json'))).toBe(true);
  expect(existsSync(join(installed, 'src'))).toBe(false);
  expect(existsSync(join(installed, 'compiled'))).toBe(false);
  expect(await readFile(join(installed, 'dist/badge.d.ts'), 'utf8')).toContain('JSX.Element');
  const discovered = await discoverPackageArtifact(Bun.resolveSync('@publication/ui', consumer), '@publication/ui', join(consumer, 'App.tsx'));
  expect(discovered?.artifact.entries['@publication/ui']?.components?.Badge, installed).toBeDefined();
  await rm(producer, { recursive: true, force: true });
  await run(process.execPath, ['check', '-p', 'tsconfig.json'], { cwd: consumer, windowsHide: true, timeout: 30_000 });

  const config = () => ({ root: consumer, configFile: false as const, logLevel: 'silent' as const,
    plugins: [memoizedDom({ clientEntry: 'main.ts', serverEntry: 'server.ts' })], server: { host: '127.0.0.1', port: 0 } });
  dev = await createDevServer(config());
  const transformed = await dev.vite.environments.client!.transformRequest('/App.tsx');
  expect(transformed?.code).toContain('connectResolvedValues([items]');
  const origins = [dev.origin];
  const builder = await createBuilder(config()); await builder.buildApp();
  const backend = await import(/* @vite-ignore */pathToFileURL(join(consumer, 'dist/server.js')).href);
  host = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: backend.default.fetch }); origins.push(host.url.origin);
  const assets = join(consumer, 'dist/client/assets');
  const browserCode = (await Promise.all((await readdir(assets)).filter(name => name.endsWith('.js')).map(name => readFile(join(assets, name), 'utf8')))).join('\n');
  expect(browserCode).not.toContain('UNUSED_PACKAGE_EXPORT_SENTINEL');
  for (const origin of origins) {
    const response = await fetch(origin); const html = await response.text();
    expect(response.status, html).toBe(200);
    const reports = await (await fetch(origin + '/__reports')).text();
    expect(html, origin + ' reports=' + reports).toMatch(/<output[^>]*>1<\/output>/);
    expect(reports).not.toContain('"outcome":"error"');
    expect(html).toContain('Package fallback'); expect(html).toContain('Caller content');
    expect(html.replace(/<!--[\s\S]*?-->/g, '')).toContain('1 ready');
    if (!chrome) continue;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
    try {
      const page = await browser.newPage(); const errors: string[] = [];
      page.on('pageerror', error => errors.push(String(error)));
      await page.goto(origin);
      await page.type('.package-draft', 'Keep my draft');
      await page.click('.package-button'); await page.waitForFunction(() => document.querySelector('output')?.textContent === '3');
      expect(await page.$$eval('.package-button', nodes => nodes.map(node => node.textContent))).toEqual(['3', '3']);
      expect(await page.$eval('.package-draft', node => (node as HTMLInputElement).value)).toBe('Keep my draft');
      const previous = await page.$eval('.item', node => node.textContent);
      await page.click('.refresh'); await page.waitForFunction(() => document.querySelector('.request')?.textContent === 'Refreshing');
      await page.waitForFunction(() => document.querySelector('.request')?.textContent === '1 ready');
      expect(await page.$eval('.item', node => node.textContent)).not.toBe(previous);
      await page.click('.toggle'); await page.waitForFunction(() => document.querySelectorAll('.badge').length === 1);
      await page.click('.toggle'); await page.waitForFunction(() => document.querySelectorAll('.badge').length === 2);
      expect(await page.$$eval('.package-button', nodes => nodes.map(node => node.textContent))).toEqual(['3', '3']);
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  }
}, 240_000);
