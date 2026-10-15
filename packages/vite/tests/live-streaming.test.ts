import { afterEach, expect, it } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';
import { waitFor } from '../../../test-support/helpers';

const root = resolve(import.meta.dirname, '../../..');
const chrome = [process.env.MMD_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium']
  .find((path): path is string => !!path && existsSync(path));
let child: ChildProcess | undefined;
async function bounded<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(label + ' timed out')), 10_000); })]); }
  finally { clearTimeout(timer); }
}
afterEach(async () => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise<void>(done => child!.once('exit', () => done()));
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    await new Promise<void>(done => killer.once('exit', () => done()));
  } else child.kill('SIGTERM');
  await stopped;
  child = undefined;
});

it.skipIf(!chrome)('automatically synchronizes Fieldnotes and protects multiple optimistic sources across browsers', async () => {
  child = spawn('node', [resolve(root, 'packages/vite/dist/cli.js'), 'dev', '--config', 'examples/fieldnotes/vite.config.ts', '--port', '0'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let log = '';
  child.stdout!.on('data', data => { log += data; });
  child.stderr!.on('data', data => { log += data; });
  let address = '';
  await waitFor(() => {
    const match = log.match(/Memoized DOM \((?:bun|node)\): (http[^\s]+)/);
    expect(match, log).not.toBeNull(); address = match![1]!;
  }, 60_000);
  let html: string;
  try { html = await (await fetch(address + '/expeditions/ice-cores', { signal: AbortSignal.timeout(15_000) })).text(); }
  catch (error) { throw new Error(`SSR: ${String(error)}\n${log}`); }
  expect(html).toContain('Drill site reached');
  const probe = await fetch(address + '/_fn/expeditions/getNotes?expeditionId=ice-cores', {
    headers: { 'x-mmd-stream': 'live' }, signal: AbortSignal.timeout(8_000),
  });
  expect(probe.headers.get('content-type')).toContain('text/event-stream');
  const probeReader = probe.body!.getReader();
  expect(new TextDecoder().decode((await probeReader.read()).value)).toContain('event: value');
  await probeReader.cancel();
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  const errors: string[] = [];
  const diagnostics: string[] = [];
  const traces: string[] = [];
  const protectionSources: Array<Promise<string | undefined>> = [];
  const pages: Page[] = [];
  let wireReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const writer = await browser.newPage();
    const viewer = await browser.newPage();
    pages.push(writer, viewer);
    for (const page of [writer, viewer]) {
      page.on('pageerror', error => errors.push(String(error)));
      page.on('console', message => {
        if (message.text().startsWith('[memoized-dom:live]')) diagnostics.push(message.text());
        if (message.text().startsWith('[memoized-dom:trace]')) traces.push(message.text());
        if (message.text().startsWith('[memoized-dom:live] protection-started')) {
          protectionSources.push(message.args()[1]!.jsonValue().then((details: unknown) => {
            return (details as { source?: string }).source;
          }).catch(() => undefined));
        }
      });
    }
    const liveRequests: string[] = [];
    const cancelledStreams: string[] = [];
    viewer.on('request', request => {
      if (request.headers()['x-mmd-stream'] === 'live') {
        expect(request.headers()['x-mmd-live-patches']).toBe('2');
        liveRequests.push(request.url());
      }
    });
    viewer.on('requestfailed', request => {
      if (request.headers()['x-mmd-stream'] === 'live') cancelledStreams.push(request.url());
    });
    const cdp = await writer.createCDPSession();
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/_fn/expeditions/postNote', requestStage: 'Response' }] });
    const releases: (() => Promise<unknown>)[] = [];
    cdp.on('Fetch.requestPaused', event => { releases.push(() => cdp.send('Fetch.continueRequest', { requestId: event.requestId })); });
    await Promise.all([writer, viewer].map(page => page.goto(address + '/expeditions/ice-cores', { waitUntil: 'domcontentloaded' })));
    for (const page of [writer, viewer]) await page.waitForFunction(() =>
      document.querySelector('[data-live-status]')?.textContent?.includes('Live notes connected') &&
      document.querySelectorAll('li.note').length === 2,
    { timeout: 30_000, polling: 100 });
    expect(new Set(liveRequests).size).toBe(2);
    expect(liveRequests.length - cancelledStreams.length).toBe(2);
    const initialRequests = liveRequests.length;
    expect(traces).toEqual([]); // Broad tracing must be opt-in.
    const wire = await fetch(address + '/_fn/expeditions/getNotes?expeditionId=ice-cores', {
      headers: { 'x-mmd-stream': 'live', 'x-mmd-live-patches': '1' }, signal: AbortSignal.timeout(15_000),
    });
    wireReader = wire.body!.getReader();
    expect(new TextDecoder().decode((await wireReader.read()).value)).toContain('event: value');
    await writer.bringToFront();

    const text = 'Optimistic note held until its response';
    await bounded(writer.type('.note-form input', text), 'typing');
    // Capture one interaction, not every continuous pull during the scenario.
    await writer.evaluate(() => {
      (globalThis as typeof globalThis & { __MEMOIZED_DOM_TRACE__?: unknown }).__MEMOIZED_DOM_TRACE__ = { component: 'ExpeditionDetail' };
    });
    await bounded(writer.click('.note-form button'), 'clicking');
    await writer.evaluate(() => {
      (globalThis as typeof globalThis & { __MEMOIZED_DOM_TRACE__?: unknown }).__MEMOIZED_DOM_TRACE__ = false;
    });
    await writer.waitForFunction(value => [...document.querySelectorAll('li.note')].some(note => note.textContent?.includes(value)), { polling: 100 }, text);
    await viewer.waitForFunction(value => [...document.querySelectorAll('li.note')].some(note => note.textContent?.includes(value)), { timeout: 10_000, polling: 100 }, text);
    expect(new TextDecoder().decode((await wireReader.read()).value)).toContain('event: patch');
    await wireReader.cancel(); wireReader = undefined;
    await waitFor(() => expect(releases).toHaveLength(1), 5_000);
    expect(await writer.$eval('.status-line', element => element.textContent)).toContain('Saving note');
    expect(await writer.$$eval('li.note', (notes, value) => notes.filter(note => note.textContent?.includes(value)).length, text)).toBe(1);
    expect(await writer.$eval('[data-note-count]', element => element.textContent)).toContain('3 notes');

    const external = 'An external change during the optimistic request';
    const posted = await fetch(address + '/_fn/expeditions/postNote', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expeditionId: 'ice-cores', text: external }),
    });
    expect(posted.status).toBe(200);
    await viewer.waitForFunction(value => [...document.querySelectorAll('li.note')].some(note => note.textContent?.includes(value)), { timeout: 10_000, polling: 100 }, external);
    expect(await writer.$$eval('li.note', (notes, value) => notes.some(note => note.textContent?.includes(value)), external)).toBe(false);
    expect(await writer.$eval('[data-note-count]', element => element.textContent)).toContain('3 notes');
    await releases.shift()!();
    await writer.waitForFunction(() => document.querySelector('.status-line')?.textContent?.includes('Note saved'), { timeout: 10_000, polling: 100 });
    await writer.waitForFunction(value => [...document.querySelectorAll('li.note')].some(note => note.textContent?.includes(value)), { timeout: 10_000, polling: 100 }, external);
    expect(await writer.$eval('[data-note-count]', element => element.textContent)).toContain('4 notes');
    expect(await writer.$$eval('li.note', (notes, value) => notes.filter(note => note.textContent?.includes(value)).length, text)).toBe(1);
    expect(liveRequests).toHaveLength(initialRequests);
    await cdp.send('Fetch.disable');

    // Failure rolls back both sources without preventing subsequent live delivery.
    await writer.type('.note-form input', 'spam rejected note');
    await writer.click('.note-form button');
    await writer.waitForFunction(() => document.querySelector('.status-line')?.textContent?.includes('Note failed'), { timeout: 10_000, polling: 100 });
    expect(await writer.$$eval('li.note', notes => notes.length)).toBe(4);
    expect(await writer.$eval('[data-note-count]', element => element.textContent)).toContain('4 notes');

    await viewer.setOfflineMode(true);
    const missed = 'A note written while the viewer was offline';
    const missedResponse = await fetch(address + '/_fn/expeditions/postNote', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expeditionId: 'ice-cores', text: missed }),
    });
    expect(missedResponse.status).toBe(200);
    await viewer.setOfflineMode(false);
    await viewer.waitForFunction(value => [...document.querySelectorAll('li.note')].some(note => note.textContent?.includes(value)), { timeout: 25_000, polling: 100 }, missed);
    const saved = await missedResponse.json() as { id: string };
    expect((await fetch(address + '/_fn/expeditions/deleteNote', {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expeditionId: 'ice-cores', noteId: saved.id }),
    })).status).toBe(200);
    await viewer.waitForFunction(value => ![...document.querySelectorAll('li.note')].some(note => note.textContent?.includes(value)), { timeout: 10_000, polling: 100 }, missed);

    await viewer.bringToFront();
    await viewer.click('a.back');
    await viewer.waitForSelector('li.expedition');
    await viewer.waitForFunction(() => document.querySelector('a[href="/expeditions/ice-cores"]')?.closest('li')
      ?.querySelector('.meta .chip:last-child')?.textContent === '4 notes', { timeout: 15_000, polling: 100 });
    await waitFor(() => expect(liveRequests.some(url => url.includes('/getExpeditions'))).toBe(true));
    const count = liveRequests.length;

    // Regression: a mounted overview receives a detail-page mutation without
    // navigation, refresh(), or a new browser GET. Deletion updates it too.
    await writer.bringToFront();
    const overviewNote = 'A detail mutation updates the overview count';
    await writer.type('.note-form input', overviewNote);
    await writer.click('.note-form button');
    await viewer.waitForFunction(() => document.querySelector('a[href="/expeditions/ice-cores"]')?.closest('li')
      ?.querySelector('.meta .chip:last-child')?.textContent === '5 notes', { timeout: 15_000, polling: 100 });
    await writer.waitForFunction(() => document.querySelector('.status-line')?.textContent?.includes('Note saved'), { timeout: 10_000, polling: 100 });
    await writer.evaluate(value => {
      const note = [...document.querySelectorAll('li.note')].find(node => node.textContent?.includes(value));
      if (!note) throw new Error('Saved note missing');
      note.querySelector('button')!.click();
    }, overviewNote);
    await viewer.waitForFunction(() => document.querySelector('a[href="/expeditions/ice-cores"]')?.closest('li')
      ?.querySelector('.meta .chip:last-child')?.textContent === '4 notes', { timeout: 15_000, polling: 100 });
    expect(liveRequests).toHaveLength(count);
    await viewer.bringToFront();
    await viewer.click('a[href="/expeditions/canopy"]');
    await viewer.waitForFunction(() => document.querySelectorAll('li.note').length === 1, { timeout: 15_000, polling: 100 });
    expect(await viewer.$eval('[data-note-count]', element => element.textContent)).toContain('1 notes');
    expect(errors, log).toEqual([]);
    expect(diagnostics.some(message => message.includes('snapshot-held'))).toBe(true);
    expect(diagnostics.some(message => message.includes('snapshot-applied'))).toBe(true);
    expect(diagnostics.some(message => message.includes('missing-mutation-confirmation'))).toBe(false);
    expect(log).toContain('[memoized-dom:live] invalidate');
    const names = await Promise.all(protectionSources);
    expect(names).toContain('getNotes');
    expect(names).toContain('getExpeditionSummary');
    for (const event of ['event-started', 'write-published', 'binding-evaluated', 'dom-write']) {
      expect(traces.some(message => message.includes(event)), `Missing ${event}: ${traces.join('\n')}`).toBe(true);
    }
  } catch (error) {
    const snapshots = await Promise.all(pages.map(page => bounded(page.evaluate(() => ({
      status: document.querySelector('[data-live-status]')?.textContent,
      rows: document.querySelectorAll('li.note').length,
      text: document.body.innerText.slice(0, 1200),
    })), 'DOM diagnostics').catch(String)));
    throw new Error(`${String(error)}\nDOM: ${JSON.stringify(snapshots)}\nBrowser errors: ${errors.join('\n')}\n${log}`);
  } finally {
    await wireReader?.cancel().catch(() => {});
    try { await bounded(browser.close(), 'browser cleanup'); }
    catch {
      const process = browser.process();
      if (process?.pid && globalThis.process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(process.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
        await new Promise<void>(done => killer.once('exit', () => done()));
      } else process?.kill('SIGKILL');
    }
  }
}, 150_000);
