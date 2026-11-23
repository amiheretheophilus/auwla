import { afterEach, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';
import { closeBrowser } from '../../../test-support/browser';
import { waitFor } from '../../../test-support/helpers';
import type { NativeDevServer } from '../src/dev';
import { serveNotesApp } from './support/notes-app';

const chrome = [process.env.MMD_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium']
  .find((path): path is string => !!path && existsSync(path));
let fixture: string | undefined;
let server: NativeDevServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  if (fixture) await rm(fixture, { recursive: true, force: true });
  fixture = undefined;
});

const hasNote = (page: Page, text: string, timeout = 10_000) => page.waitForFunction(
  (value) => [...document.querySelectorAll('li.note')].some((note) => note.textContent?.includes(value)),
  { timeout, polling: 100 }, text,
);
const countOf = (page: Page) => page.$eval('[data-note-count]', (element) => element.textContent);
const overviewCount = (page: Page, count: string) => page.waitForFunction(
  (value) => document.querySelector('[data-expedition="ice-cores"] b')?.textContent === value,
  { timeout: 15_000, polling: 100 }, count,
);

it.skipIf(!chrome)('keeps live notes in sync across browsers and protects both optimistic sources', async () => {
  fixture = await mkdtemp(join(tmpdir(), 'memoized-dom-live-notes-'));
  server = await serveNotesApp(fixture);
  const address = server.origin;

  expect(await (await fetch(address)).text()).toContain('Drill site reached');
  const probe = await fetch(address + '/_fn/notes/getNotes?expeditionId=ice-cores', { headers: { 'x-mmd-stream': 'live' } });
  expect(probe.headers.get('content-type')).toContain('text/event-stream');
  const probeReader = probe.body!.getReader();
  expect(new TextDecoder().decode((await probeReader.read()).value)).toContain('event: value');
  await probeReader.cancel();

  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  const errors: string[] = [];
  const diagnostics: string[] = [];
  const protectedSources: Array<Promise<string | undefined>> = [];
  let wireReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const writer = await browser.newPage();
    const viewer = await browser.newPage();
    for (const page of [writer, viewer]) {
      page.on('pageerror', (error) => errors.push(String(error)));
      page.on('console', (message) => {
        if (message.text().startsWith('[memoized-dom:live]')) diagnostics.push(message.text());
        if (message.text().startsWith('[memoized-dom:live] protection-started')) {
          protectedSources.push(message.args()[1]!.jsonValue()
            .then((details: unknown) => (details as { source?: string }).source)
            .catch(() => undefined));
        }
      });
    }
    // Each page opens one shared live connection; later reads join it through controls.
    const sessions: string[] = [];
    const subscriptions: string[] = [];
    viewer.on('request', (request) => {
      if (request.headers()['x-mmd-multiplex'] !== '1') return;
      const control = JSON.parse(request.postData()!) as { session?: string; subscribe: { url: string }[] };
      subscriptions.push(...control.subscribe.map((item) => item.url));
      if (!control.session) sessions.push(request.url());
    });
    const cdp = await writer.createCDPSession();
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/_fn/notes/postNote', requestStage: 'Response' }] });
    const held: (() => Promise<unknown>)[] = [];
    cdp.on('Fetch.requestPaused', (event) => { held.push(() => cdp.send('Fetch.continueRequest', { requestId: event.requestId })); });

    await Promise.all([writer, viewer].map((page) => page.goto(address, { waitUntil: 'domcontentloaded' })));
    for (const page of [writer, viewer]) {
      await page.waitForFunction(() => document.querySelector('[data-live-status]')?.textContent?.includes('Live notes connected')
        && document.querySelectorAll('li.note').length === 2, { timeout: 30_000, polling: 100 });
    }
    expect(sessions).toHaveLength(1);
    expect(subscriptions.some((url) => url.includes('/getNotes'))).toBe(true);
    expect(subscriptions.some((url) => url.includes('/getSummary'))).toBe(true);
    expect(subscriptions.some((url) => url.includes('/getExpeditions'))).toBe(true);

    const wire = await fetch(address + '/_fn/notes/getNotes?expeditionId=ice-cores', {
      headers: { 'x-mmd-stream': 'live', 'x-mmd-live-patches': '1' },
    });
    wireReader = wire.body!.getReader();
    expect(new TextDecoder().decode((await wireReader.read()).value)).toContain('event: value');

    // The optimistic note shows at once, and stays the only copy while its response is held,
    // even though the server already saved it and told every reader.
    await writer.bringToFront();
    const text = 'Optimistic note held until its response';
    await writer.type('.note-form input', text);
    await writer.click('.note-form button');
    await hasNote(writer, text);
    await hasNote(viewer, text);
    expect(new TextDecoder().decode((await wireReader.read()).value)).toContain('event: patch');
    await wireReader.cancel(); wireReader = undefined;
    await waitFor(() => expect(held).toHaveLength(1), 5_000);
    expect(await writer.$eval('.status-line', (element) => element.textContent)).toContain('Saving note');
    expect(await writer.$$eval('li.note', (notes, value) => notes.filter((note) => note.textContent?.includes(value)).length, text)).toBe(1);
    expect(await countOf(writer)).toContain('3 notes');

    // Another change meanwhile reaches the viewer; the writer's protected sources hold it back.
    const external = 'An external change during the optimistic request';
    expect((await fetch(address + '/_fn/notes/postNote', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expeditionId: 'ice-cores', text: external }),
    })).status).toBe(200);
    await hasNote(viewer, external);
    expect(await writer.$$eval('li.note', (notes, value) => notes.some((note) => note.textContent?.includes(value)), external)).toBe(false);
    expect(await countOf(writer)).toContain('3 notes');

    // The response arrives: the writer reconciles, then applies what it held back.
    await held.shift()!();
    await writer.waitForFunction(() => document.querySelector('.status-line')?.textContent?.includes('Note saved'), { timeout: 10_000, polling: 100 });
    await hasNote(writer, external);
    expect(await countOf(writer)).toContain('4 notes');
    expect(await writer.$$eval('li.note', (notes, value) => notes.filter((note) => note.textContent?.includes(value)).length, text)).toBe(1);
    await cdp.send('Fetch.disable');

    // A rejected note rolls both sources back, and live delivery carries on.
    await writer.type('.note-form input', 'spam rejected note');
    await writer.click('.note-form button');
    await writer.waitForFunction(() => document.querySelector('.status-line')?.textContent?.includes('Note failed'), { timeout: 10_000, polling: 100 });
    expect(await writer.$$eval('li.note', (notes) => notes.length)).toBe(4);
    expect(await countOf(writer)).toContain('4 notes');

    // A viewer that was offline catches up when it reconnects.
    await viewer.setOfflineMode(true);
    const missed = 'A note written while the viewer was offline';
    const missedResponse = await fetch(address + '/_fn/notes/postNote', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expeditionId: 'ice-cores', text: missed }),
    });
    expect(missedResponse.status).toBe(200);
    await viewer.setOfflineMode(false);
    await hasNote(viewer, missed, 25_000);
    const saved = await missedResponse.json() as { id: string };
    expect((await fetch(address + '/_fn/notes/deleteNote', {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expeditionId: 'ice-cores', noteId: saved.id }),
    })).status).toBe(200);
    await viewer.waitForFunction((value) => ![...document.querySelectorAll('li.note')].some((note) => note.textContent?.includes(value)),
      { timeout: 10_000, polling: 100 }, missed);

    // The overview, another live read on the page, follows a change made in the detail,
    // with no new connection, navigation or refresh. A deletion updates it too.
    await overviewCount(viewer, '4 notes');
    const sessionsBefore = sessions.length;
    await writer.bringToFront();
    const overviewNote = 'A detail change updates the overview count';
    await writer.type('.note-form input', overviewNote);
    await writer.click('.note-form button');
    await overviewCount(viewer, '5 notes');
    await writer.waitForFunction(() => document.querySelector('.status-line')?.textContent?.includes('Note saved'), { timeout: 10_000, polling: 100 });
    await writer.evaluate((value) => {
      const note = [...document.querySelectorAll('li.note')].find((node) => node.textContent?.includes(value));
      if (!note) throw new Error('Saved note missing');
      note.querySelector('button')!.click();
    }, overviewNote);
    await overviewCount(viewer, '4 notes');
    expect(sessions).toHaveLength(sessionsBefore);

    await viewer.bringToFront();
    await viewer.click('.open-canopy');
    await viewer.waitForFunction(() => document.querySelectorAll('li.note').length === 1, { timeout: 15_000, polling: 100 });
    expect(await countOf(viewer)).toContain('1 notes');

    expect(errors).toEqual([]);
    expect(diagnostics.some((message) => message.includes('snapshot-held'))).toBe(true);
    expect(diagnostics.some((message) => message.includes('snapshot-applied'))).toBe(true);
    expect(diagnostics.some((message) => message.includes('missing-mutation-confirmation'))).toBe(false);
    // Both requests named in `source` were protected, not their payloads.
    const names = await Promise.all(protectedSources);
    expect(names).toContain('getNotes');
    expect(names).toContain('getSummary');
  } finally {
    await wireReader?.cancel().catch(() => {});
    await closeBrowser(browser);
  }
}, 150_000);
