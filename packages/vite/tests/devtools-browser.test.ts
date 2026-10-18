import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { build, createServer, type ViteDevServer } from 'vite';
import memoizedDom from '../src';
import { createDevServer, type NativeDevServer } from '../src/dev';
import { closeBrowser } from '../../../test-support/browser';

const chrome = [process.env.MMD_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium']
  .find((path): path is string => !!path && existsSync(path));
let root: string, browser: Browser | undefined, native: NativeDevServer | undefined, vite: ViteDevServer | undefined;
const write = async (file: string, source: string) => { const path = join(root, file); await mkdir(dirname(path), { recursive: true }); await writeFile(path, source); };
const inspectorText = (page: Page, value: string) => page.waitForFunction(text => document.querySelector('memoized-dom-inspector')?.shadowRoot?.textContent?.includes(text), {}, value);
const inspectorClick = (page: Page, selector: string) => page.evaluate(selector => {
  const button = document.querySelector('memoized-dom-inspector')?.shadowRoot?.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error('Missing inspector control ' + selector); button.click();
}, selector);
beforeEach(async () => {
  const parent = resolve(import.meta.dirname, 'fixtures/out'); await mkdir(parent, { recursive: true });
  root = await mkdtemp(join(parent, 'devtools-'));
  await write('package.json', '{"type":"module"}');
  await write('index.html', '<!doctype html><html><head><title>Inspector</title></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/main.ts"></script></body></html>');
  await write('main.ts', `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`);
  await write('App.tsx', `export function App(){let count=0;return <main><input id="draft"/><output>{count}</output><button id="increment" onClick={()=>count++}>Increment</button><section if={count>1}>Visible region</section></main>;}`);
});
afterEach(async () => {
  if (browser) await closeBrowser(browser); browser = undefined;
  console.info('[inspector test cleanup] browser closed');
  await native?.close(); native = undefined; await vite?.close(); vite = undefined;
  console.info('[inspector test cleanup] Vite closed');
  await rm(root, { recursive: true, force: true });
}, 60_000);

it.skipIf(!chrome)('lazily opens the isolated UI, captures real traces without console opt-in, and cleans up on close', async () => {
  vite = await createServer({ root, configFile: false, logLevel: 'silent', plugins: [memoizedDom({ clientEntry: './main.ts' })], server: { host: '127.0.0.1', port: 0 } });
  await vite.listen(); const address = vite.httpServer!.address(); if (!address || typeof address === 'string') throw Error('No server port');
  browser = await puppeteer.launch({ executablePath: chrome, headless: true }); const page = await browser.newPage();
  const requests: string[] = [], errors: string[] = [], traces: string[] = [];
  page.on('request', request => requests.push(request.url())); page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().startsWith('[memoized-dom:trace]')) traces.push(message.text()); });
  await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'networkidle0' });
  expect(await page.$('memoized-dom-inspector')).toBeNull();
  expect(requests.some(url => url.includes('/devtools/dist/client') || url.includes('inspector.css') || url.includes('.woff2'))).toBe(false);
  await page.type('#draft', 'keep this draft'); await page.click('#increment');
  await page.keyboard.down('Alt'); await page.keyboard.down('Shift'); await page.keyboard.press('KeyM'); await page.keyboard.up('Shift'); await page.keyboard.up('Alt');
  await page.waitForSelector('memoized-dom-inspector'); await inspectorClick(page, '[data-tab="events"]');
  await inspectorText(page, 'Click handler'); await inspectorText(page, 'not run during this capture');
  expect(await page.evaluate(() => document.querySelector('memoized-dom-inspector')!.shadowRoot!.querySelectorAll('[data-tab]').length)).toBe(4);
  await page.click('#increment'); await inspectorText(page, '1 invocations');
  expect(await page.evaluate(() => document.querySelector('memoized-dom-inspector')!.shadowRoot!.querySelector('[data-trace]')?.hasAttribute('data-activation'))).toBe(true);
  await inspectorClick(page, '[data-tab="regions"]'); await inspectorText(page, 'Conditional region');
  const region = await page.evaluate(() => document.querySelector('memoized-dom-inspector')!.shadowRoot!.querySelector('.source-code')?.textContent);
  expect(region).toContain('<section if={count>1}>');
  await inspectorClick(page, '[data-tab="events"]'); await inspectorText(page, 'Click handler');
  // Inspect an actual compiler-produced handler, not a fabricated diagnostic.
  await page.evaluate(() => {
    const shadow = document.querySelector('memoized-dom-inspector')!.shadowRoot!;
    const card = [...shadow.querySelectorAll<HTMLButtonElement>('[data-trace]')].find(node => node.querySelector('b')?.textContent === 'Click handler');
    if (!card) throw new Error('Missing click record'); card.click();
  });
  await inspectorText(page, 'Authored JSX');
  const source = await page.evaluate(() => {
    const shadow = document.querySelector('memoized-dom-inspector')!.shadowRoot!;
    return { header: shadow.querySelector('.source-heading')?.textContent, code: shadow.querySelector('.source-code')?.textContent,
      marked: [...shadow.querySelectorAll('.source-code mark')].map(node => node.textContent).join('') };
  });
  expect(source.header).toContain('App.tsx:1:'); expect(source.header).toContain('App');
  expect(source.code).toContain('<button'); expect(source.code).toContain('</button>'); expect(source.code).not.toContain('<main>');
  expect(source.marked).toBe('onClick={()=>count++}');
  expect(await page.$eval('output', node => node.textContent)).toBe('2'); expect(traces).toEqual([]);
  expect(await page.$eval('#draft', node => (node as HTMLInputElement).value)).toBe('keep this draft');
  await page.waitForFunction(() => {
    const panel = document.querySelector('memoized-dom-inspector')?.shadowRoot?.querySelector('.inspector');
    return panel && getComputedStyle(panel).fontFamily.includes('Geist');
  });
  await page.waitForFunction(() => document.fonts.check('13px "Memoized Inspector Geist"') && [...document.fonts].some(font => font.family.includes('Memoized Inspector Geist') && font.status === 'loaded'));
  expect(requests.some(url => url.includes('geist-latin-wght-normal.woff2'))).toBe(true);
  expect(requests.filter(url => url.includes('.woff2')).every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  if (process.env.MMD_INSPECTOR_CAPTURE) await page.screenshot({ path: process.env.MMD_INSPECTOR_CAPTURE });
  await inspectorClick(page, '[data-action="expand"]'); expect(await page.$eval('memoized-dom-inspector', node => node.hasAttribute('data-expanded'))).toBe(true);
  if (process.env.MMD_INSPECTOR_CAPTURE) {
    await inspectorClick(page, '[data-action="theme"]'); await inspectorClick(page, '[data-action="theme"]');
    await page.screenshot({ path: process.env.MMD_INSPECTOR_CAPTURE.replace('.png', '-dark.png') });
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: process.env.MMD_INSPECTOR_CAPTURE.replace('.png', '-mobile.png') });
  }
  await inspectorClick(page, '[data-action="close"]'); expect(await page.$('memoized-dom-inspector')).toBeNull();
  expect(await page.evaluate(() => (globalThis as unknown as Record<symbol, unknown>)[Symbol.for('memoized-dom:diagnostics:v1')])).toBeUndefined();
  await page.click('#increment'); expect(await page.$eval('output', node => node.textContent)).toBe('3'); expect(errors).toEqual([]);
}, 120_000);

it.skipIf(!chrome)('shows existing multiplexed sources separately, relays native server observations, and never captures payloads', async () => {
  await write('server/define.ts', `import {createDefine} from '@memoized-dom/server';export const define=createDefine();`);
  await write('server/services/notes.ts', `import {define} from '../define';export const notes=define.service('notes',()=>{let items=[{id:'one',text:'secret-response-value'}];return {all:()=>items,add(){items=[...items,{id:'next',text:'secret-response-value'}];return items.length;}}});`);
  await write('server/functions/notes.ts', `import {define} from '../define';
   export const getNotes=define.function({live:(_c,id:string)=>['notes',id],get:async({services},_id:string)=>services.notes.all()});
   export const getSummary=define.function({live:(_c,id:string)=>['notes',id],get:async({services},_id:string)=>({count:services.notes.all().length})});
   export const postNote=define.function({updates:(_c,id:string)=>['notes',id],post:async({services},_id:string)=>services.notes.add()});
   export const unmatched=define.function({updates:()=>['notse'],post:async()=>true});`);
  await write('App.tsx', `import {getNotes,getSummary,postNote,unmatched} from '#server-functions';export function App(){const notes=getNotes('canopy');const summary=getSummary('canopy');return <main><input id="draft"/><span id="count">{summary.count}</span><ul>{notes.map(note=><li key={note.id}>{note.text}</li>)}</ul><button id="add" onClick={()=>postNote('canopy')}>Add</button><button id="unmatched" onClick={()=>unmatched()}>Unmatched</button></main>;}`);
  await write('server.ts', `import {serve} from '@memoized-dom/server';import {define} from './server/define';import {App} from './App';const app=serve({define});app.ssr(App);export default app;`);
  native = await createDevServer({ root, configFile: false, logLevel: 'silent', plugins: [memoizedDom({ clientEntry: './main.ts', serverEntry: './server.ts' })], server: { host: '127.0.0.1', port: 0 } });
  browser = await puppeteer.launch({ executablePath: chrome, headless: true }); const page = await browser.newPage();
  let requests = 0; page.on('request', request => { if (request.url().includes('/_memoized/live') || request.url().includes('/_fn/')) requests++; });
  await page.goto(native.origin, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => document.querySelector('#count')?.textContent === '1');
  await page.waitForFunction(() => ((globalThis as unknown as Record<symbol, Set<unknown>>)[Symbol.for('memoized-dom:diagnostic-providers:v1')]?.size ?? 0) >= 3);
  const before = requests;
  await page.keyboard.down('Alt'); await page.keyboard.down('Shift'); await page.keyboard.press('KeyM'); await page.keyboard.up('Shift'); await page.keyboard.up('Alt');
  await inspectorText(page, 'browser + native server'); await inspectorText(page, 'getSummary');
  expect(await page.evaluate(() => document.querySelector('memoized-dom-inspector')!.shadowRoot!.querySelectorAll('[data-source]').length)).toBe(2);
  await inspectorText(page, '1 connection'); expect(requests).toBe(before);
  await page.evaluate(() => {
    const original = document.createElement('input'); original.id = 'private-input'; original.value = 'secret-input-value'; document.querySelector('main')!.append(original);
  });
  // The dock can cover the bottom of a short fixture; DOM click is intentional and
  // exercises its compiled handler without hiding/closing the inspector.
  await page.$eval('#unmatched', node => (node as HTMLButtonElement).click());
  await inspectorClick(page, '[data-tab="issues"]'); await inspectorText(page, 'matched no active key');
  if (process.env.MMD_INSPECTOR_CAPTURE) await page.screenshot({ path: process.env.MMD_INSPECTOR_CAPTURE.replace('.png', '-issues.png') });
  const text = await page.evaluate(() => document.querySelector('memoized-dom-inspector')!.shadowRoot!.textContent!);
  expect(text).not.toContain('secret-response-value'); expect(text).not.toContain('secret-input-value');
  await page.$eval('#add', node => (node as HTMLButtonElement).click()); await page.waitForFunction(() => document.querySelector('#count')?.textContent === '2');
  await inspectorClick(page, '[data-tab="live"]'); await inspectorText(page, 'Server observations');
  if (process.env.MMD_INSPECTOR_CAPTURE) {
    await page.setViewport({ width: 1280, height: 900 });
    await page.screenshot({ path: process.env.MMD_INSPECTOR_CAPTURE.replace('.png', '-live.png') });
  }
}, 150_000);

it('omits launcher, renderer, fonts and diagnostic capture bridges from production output and supports dev opt-out', async () => {
  vite = await createServer({ root, configFile: false, logLevel: 'silent', plugins: [memoizedDom({ clientEntry: './main.ts', devtools: false })], server: { middlewareMode: true } });
  const document = await vite.transformIndexHtml('/', await readFile(join(root, 'index.html'), 'utf8'));
  expect(document).not.toContain('virtual:memoized-dom/inspector'); await vite.close(); vite = undefined;
  await write('App.tsx', `export function App(){const notes=$fetch<string[]>('/notes');return <main>{notes.length}</main>;}`);
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { await build({ root, configFile: false, logLevel: 'silent', plugins: [memoizedDom({ clientEntry: './main.ts' })] }); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
  const html = await readFile(join(root, 'dist/index.html'), 'utf8'); expect(html).not.toContain('inspector');
  const files = await readdir(join(root, 'dist/assets'));
  expect(files.some(file => /inspector|geist|woff/.test(file))).toBe(false);
  for (const file of files.filter(file => file.endsWith('.js'))) {
    const code = await readFile(join(root, 'dist/assets', file), 'utf8');
    const capture = code.indexOf('memoized-dom:diagnostics:v1');
    expect(capture === -1, code.slice(Math.max(0, capture - 900), capture + 1000)).toBe(true); expect(code).not.toContain('memoized-dom-inspector');
  }
}, 90_000);
