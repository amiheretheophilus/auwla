/**
 * Hot replacement with compiler-next in a real browser (`wiki/compiler/project.md`, "Hot
 * replacement"; the last part of the plan's HMR item): an edited component is replaced in place
 * and the rest of the page keeps its state, `.auwla` included; the edited component's own state
 * starts again; an error shows Vite's overlay and the fix clears it in place; an edit to the entry, which
 * accepts nothing, reloads the page.
 */
import { afterAll, afterEach, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { createServer, type ViteDevServer } from 'vite';
import { browserExecutable, closeBrowser } from '../../../test-support/browser';
import memoizedDom from '../src';

const executablePath = browserExecutable();

// Inside the package, so the app finds the workspace's packages as an app finds its own.
const root = mkdtempSync(join(import.meta.dir, '../.next-test-hmr-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let server: ViteDevServer | undefined;
let browser: Browser | undefined;
afterEach(async () => {
  if (browser !== undefined) await closeBrowser(browser);
  browser = undefined;
  await server?.close();
  server = undefined;
}, 60_000);

function write(path: string, text: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** When each file was last written. */
const written = new Map<string, number>();

/**
 * Saves `path` with `from` replaced, as an editor would. A second save of the same file within a
 * few milliseconds of the first can reach Vite's file watcher as no change at all (seen on
 * Windows: the fix after an error, saved as soon as the overlay showed, never arrived), and no
 * person saves that fast, so saves of one file are spaced by a moment.
 */
async function edit(path: string, from: string, to: string): Promise<void> {
  const since = Date.now() - (written.get(path) ?? 0);
  if (since < 300) await new Promise((resolve) => setTimeout(resolve, 300 - since));
  const text = readFileSync(join(root, path), 'utf8');
  if (!text.includes(from)) throw new Error(`${path} has no '${from}'`);
  writeFileSync(join(root, path), text.replace(from, to));
  written.set(path, Date.now());
}

/** The page's state: what it shows, how many times it loaded, and whether this document is the first. */
function state(page: Page) {
  return page.evaluate(() => ({
    title: document.querySelector('h1')?.textContent,
    badge: document.querySelector('#badge')?.textContent,
    count: document.querySelector('#count')?.textContent,
    mains: document.querySelectorAll('main').length,
    loads: sessionStorage.getItem('loads'),
    sameDocument: (window as { firstDocument?: boolean }).firstDocument === true,
  }));
}

it.skipIf(executablePath === null)('replaces edited components in place in a browser, keeping the rest of the page', async () => {
  write('index.html', '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>');
  write('src/main.ts', [
    "import { mount } from '@memoized-dom/runtime';",
    "import { App } from './App';",
    "sessionStorage.setItem('loads', String(Number(sessionStorage.getItem('loads') ?? '0') + 1));",
    "mount('root', App);",
    '',
  ].join('\n'));
  write('src/App.tsx', [
    "import { Title } from './Title';",
    "import { Badge } from './Badge.auwla';",
    "import { Counter } from './Counter';",
    'export function App() { return <main><Title /><Badge /><Counter /></main>; }',
    '',
  ].join('\n'));
  write('src/Title.tsx', 'export function Title() { return <h1>first</h1>; }\n');
  write('src/Badge.auwla', 'export function Badge() { return <b id="badge">"one"</b> }\n');
  write('src/Counter.tsx', 'export function Counter() { let count = 0; return <button id="count" onClick={() => count++}>{count}</button>; }\n');

  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [memoizedDom({ clientEntry: 'src/main.ts', compiler: 'next' })],
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') throw new Error('Vite gave no TCP address');
  // What Vite tells the browser: a full reload is the one thing an in-place update must not send.
  const sent: string[] = [];
  const hot = server.environments.client.hot;
  const send = hot.send.bind(hot);
  hot.send = ((payload: { type: string }, ...rest: unknown[]) => {
    sent.push(payload.type);
    return (send as (...values: unknown[]) => void)(payload, ...rest);
  }) as typeof hot.send;

  browser = await puppeteer.launch({ headless: true, executablePath: executablePath! });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { (window as { firstDocument?: boolean }).firstDocument = true; });
  for (let click = 0; click < 3; click++) await page.click('#count');
  expect(await state(page)).toEqual({ title: 'first', badge: 'one', count: '3', mains: 1, loads: '1', sameDocument: true });

  // A sibling component edited: replaced in place, the counter keeps its count.
  await edit('src/Title.tsx', 'first', 'second');
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'second');
  expect(await state(page)).toEqual({ title: 'second', badge: 'one', count: '3', mains: 1, loads: '1', sameDocument: true });

  // The same for a component written in `.auwla`.
  await edit('src/Badge.auwla', '"one"', '"two"');
  await page.waitForFunction(() => document.querySelector('#badge')?.textContent === 'two');
  expect(await state(page)).toEqual({ title: 'second', badge: 'two', count: '3', mains: 1, loads: '1', sameDocument: true });

  // The edited component's own state starts again, as with the old compiler.
  await edit('src/Counter.tsx', '{count}</button>', '{count + 10}</button>');
  await page.waitForFunction(() => document.querySelector('#count')?.textContent === '10');
  expect(await state(page)).toEqual({ title: 'second', badge: 'two', count: '10', mains: 1, loads: '1', sameDocument: true });
  expect(sent).not.toContain('full-reload');
  expect(errors).toEqual([]);

  // An error shows Vite's overlay, and the page keeps showing the last good version. The fix
  // clears the overlay with an ordinary update: Vite's client loads the page again only when
  // the first update after a load is a fix.
  await edit('src/Title.tsx', '<h1>second</h1>', '<h1>second</h2>');
  await page.waitForFunction(() => document.querySelector('vite-error-overlay') !== null);
  expect(await state(page)).toEqual({ title: 'second', badge: 'two', count: '10', mains: 1, loads: '1', sameDocument: true });
  await edit('src/Title.tsx', '<h1>second</h2>', '<h1>third</h1>');
  await page.waitForFunction(() => document.querySelector('vite-error-overlay') === null
    && document.querySelector('h1')?.textContent === 'third');
  expect(await state(page)).toEqual({ title: 'third', badge: 'two', count: '10', mains: 1, loads: '1', sameDocument: true });

  // The entry accepts no update, so editing it loads the page again. A code change: a comment
  // alone prints the same output, so no update is sent at all.
  await edit('src/main.ts', "mount('root', App);", "mount('root', App);\ndocument.title = 'edited';");
  await page.waitForFunction(() => sessionStorage.getItem('loads') === '2');
  // A new document: the counter starts again from 0 (shown as `count + 10`).
  expect(await state(page)).toEqual({ title: 'third', badge: 'two', count: '10', mains: 1, loads: '2', sameDocument: false });
  expect(errors).toEqual([]);
}, 90_000);
