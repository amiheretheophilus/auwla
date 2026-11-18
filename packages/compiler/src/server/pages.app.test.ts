/**
 * Server pages end to end (`wiki/compiler/server.md`, "Server pages"): an application built by the
 * command line, whose server functions return `page(...)`. The built server renders them into the
 * document and answers their endpoints; the browser binds the interactive page and keeps its local
 * state when a POST returns the same page with new inputs. The browser half runs where Chrome is
 * installed, as the Vite suite's does.
 */
import { afterAll, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { decodePageHtml } from '../../../runtime/src/page-html';
import { closeBrowser } from '../../../../test-support/browser';
import { parseArguments, run } from '../project/cli';

// Inside the package (not `src/`), so a build finds the workspace's packages as an app finds its own.
const root = mkdtempSync(join(import.meta.dir, '../../.pages-test-'));
let host: ReturnType<typeof Bun.serve> | undefined;
afterAll(async () => {
  await host?.stop(true);
  rmSync(root, { recursive: true, force: true });
});

const chrome = [process.env.MMD_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium']
  .find((path): path is string => path !== undefined && existsSync(path));

function write(path: string, text: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
}

write('index.html', '<!doctype html><html><head><title>pages</title></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="./src/main.ts"></script></body></html>');
write('src/main.ts', `import { mount } from '@memoized-dom/runtime';\nimport { App } from './App';\nmount('root', App);\n`);
write('src/App.tsx', `
import { getBoard, saveBoard, getDenied } from '#server-functions';
import { Group } from '@memoized-dom/data';
function Loading() { return <p data-loading>Waiting for server UI</p>; }
export function App() {
  let board = getBoard();
  return <main>
    <Group pending={Loading}><div suspend>{board}</div></Group>
    <button data-save onClick={() => { board = saveBoard(); }}>Save</button>
    <button data-deny onClick={() => { board = getDenied(); }}>Denied</button>
  </main>;
}
`);
write('src/Board.tsx', `
export function Board({ count, user, subtitle = 'No subtitle' }) {
  let expanded = false;
  let hint = '';
  function reveal() { hint = user.hint; }
  return <section data-board>
    <h1>{user.name}</h1>
    <small data-subtitle>{subtitle}</small>
    <p data-count>{count}</p>
    <button data-reveal onClick={reveal}>Reveal</button>
    <p data-hint>{hint}</p>
    <button data-toggle onClick={() => { expanded = !expanded; }}>Toggle</button>
    {expanded && <p data-expanded>Expanded</p>}
  </section>;
}
`);
write('server/define.ts', `import { createDefine } from '@memoized-dom/server';\nexport const define = createDefine();\nexport { page } from '@memoized-dom/server';\n`);
write('server/functions/boards.tsx', `
import { define, page } from '../define';
import { Board } from '../../src/Board';
let count = 0;
export const getBoard = define.function({
  live: () => ['board'],
  async get() {
    const user = { name: 'Ada', hint: 'Event-only', password: 'SERVER_SECRET' };
    const subtitle = undefined;
    return page(<Board count={count} user={user} subtitle={subtitle} />);
  },
});
export const saveBoard = define.function({
  updates: () => ['board'],
  async post() {
    count++;
    const user = { name: 'Saved', hint: 'Event-only', password: 'SERVER_SECRET' };
    const subtitle = undefined;
    return page(<Board count={count} user={user} subtitle={subtitle} />);
  },
});
export const getDenied = define.function({ async get() { return page(<p data-denied>Denied</p>); } });
`);
write('server.ts', `import { serve } from '@memoized-dom/server';\nimport { define } from '#server/define';\nimport { App } from './src/App';\nconst app = serve({ define });\napp.ssr(App);\nexport default app;\n`);

/** The built server, built once for every test. */
const built = (async () => {
  const command = parseArguments(['build', 'src/main.ts', '--server', 'server.ts', '--server-folder', 'server'], root);
  if (typeof command === 'string') throw new Error(command);
  const lines: string[] = [];
  const status = await run(command, (line) => lines.push(line));
  if (status !== 0) throw new Error(lines.join('\n'));
  const { default: app } = await import(pathToFileURL(join(root, 'dist', 'server.js')).href);
  return app as { fetch(request: Request): Promise<Response> };
})();

it('renders the page into the document and keeps unread fields off the wire', async () => {
  const app = await built;
  const html = await (await app.fetch(new Request('http://localhost/'))).text();
  expect(html).toMatch(/<h1[^>]*>Ada<\/h1>/);
  expect(html).not.toContain('SERVER_SECRET');
  expect(html).not.toContain('Waiting for server UI');
});

it('answers a page endpoint with versioned HTML and the inputs the browser reads', async () => {
  const app = await built;
  const response = await app.fetch(new Request('http://localhost/_fn/boards/getBoard', { headers: { 'x-mmd-stream': 'snapshot' } }));
  const content = await response.text();
  expect(response.status, content).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(response.headers.get('x-mmd-page')).toBe('1');
  expect(content).not.toContain('SERVER_SECRET');
  const page = decodePageHtml(content) as { html: string; binding?: { key: string; inputs: unknown[] } };
  expect(page.html).toContain('Ada');
  // count, user.name and user.hint (the handler reads it), and the missing subtitle.
  expect(page.binding?.inputs).toEqual([0, { name: 'Ada', hint: 'Event-only' }, null]);
});

it('sends a page that cannot change as plain HTML, with no binding', async () => {
  const app = await built;
  const content = await (await app.fetch(new Request('http://localhost/_fn/boards/getDenied', { headers: { 'x-mmd-stream': 'snapshot' } }))).text();
  const page = decodePageHtml(content) as { html: string; binding?: unknown };
  expect(page.html).toContain('data-denied');
  expect(page.binding).toBeUndefined();
});

it('ships the interactive page component to the browser, and no server code or passive page', async () => {
  await built;
  const scripts = readdirSync(join(root, 'dist', 'client'), { recursive: true })
    .map(String).filter((file) => file.endsWith('.js'))
    .map((file) => readFileSync(join(root, 'dist', 'client', file), 'utf8'));
  // The board's component, which only the page module imports.
  expect(scripts.some((code) => code.includes('data-reveal'))).toBe(true);
  for (const code of scripts) {
    expect(code).not.toContain('SERVER_SECRET');
    // The handlers' own text.
    expect(code).not.toContain("hint: 'Event-only'");
    // The denial page cannot change: the browser gets its HTML, never its component.
    expect(code).not.toContain('data-denied');
  }
});

it.skipIf(chrome === undefined)('binds the page in a browser, and keeps its local state across a POST', async () => {
  const app = await built;
  host = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => app.fetch(request) });
  const browser = await puppeteer.launch({ executablePath: chrome!, headless: true });
  const errors: string[] = [];
  try {
    const tab = await browser.newPage();
    tab.on('pageerror', (error) => errors.push(String(error)));
    tab.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await tab.goto(host.url.origin, { waitUntil: 'domcontentloaded' });
    // Handlers are added with addEventListener, so the page is bound once a click is answered.
    const revealed = () => {
      (document.querySelector('[data-reveal]') as HTMLButtonElement | null)?.click();
      return document.querySelector('[data-hint]')?.textContent === 'Event-only';
    };
    await tab.waitForFunction(revealed, { timeout: 10_000, polling: 100 }).catch(async (error: unknown) => {
      throw new Error(`${String(error)}\n${errors.join('\n')}\n${await tab.content()}`);
    });
    expect(await tab.$eval('[data-subtitle]', (node) => node.textContent)).toBe('No subtitle');
    await tab.click('[data-toggle]');
    await tab.waitForSelector('[data-expanded]', { timeout: 5000 });

    // The POST's page is another call site: it replaces the GET's, and is bound in its turn.
    await tab.click('[data-save]');
    await tab.waitForFunction(() => document.querySelector('[data-count]')?.textContent === '1', { timeout: 10_000, polling: 100 });
    expect(await tab.$eval('h1', (node) => node.textContent)).toBe('Saved');
    await tab.click('[data-toggle]');
    await tab.waitForSelector('[data-expanded]', { timeout: 5000 });

    // The same call site again, with new inputs: the bound component updates in place, keeping
    // its local state and its nodes.
    await tab.evaluate(() => { (window as unknown as { board: Element | null }).board = document.querySelector('[data-board]'); });
    await tab.click('[data-save]');
    await tab.waitForFunction(() => document.querySelector('[data-count]')?.textContent === '2', { timeout: 10_000, polling: 100 });
    expect(await tab.$('[data-expanded]')).not.toBeNull();
    expect(await tab.evaluate(() => document.querySelector('[data-board]') === (window as unknown as { board: Element }).board)).toBe(true);

    // A different page replaces it.
    await tab.click('[data-deny]');
    await tab.waitForSelector('[data-denied]', { timeout: 10_000 });
    expect(await tab.$('[data-board]')).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await closeBrowser(browser);
  }
}, 60_000);
