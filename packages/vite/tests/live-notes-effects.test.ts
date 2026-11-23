import { afterEach, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { closeBrowser } from '../../../test-support/browser';
import { waitFor } from '../../../test-support/helpers';
import type { NativeDevServer } from '../src/dev';
import { NOTES_APP, serveNotesApp } from './support/notes-app';

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

/** Each note is a component with effects of its own, and can be edited in place. */
const notes = `
export interface Note { id: string; text: string; by: string }
type Props = { note: Note; isDeleting: boolean; isSaving: boolean; onDelete: (id: string) => void; onSave: (input: { noteId: string; text: string }) => unknown };
export function Notes({ note, isDeleting, isSaving, onDelete, onSave }: Props) {
  let editing = false;
  let text = note.text;
  $effect(() => { console.log('note-effect:editing', editing); });
  $effect(() => { console.log('note-effect:value', note); });
  return (
    <div>
      {!editing ? (
        <li class="note" data-note={note.id} onDblClick={() => { editing = true; }}>
          {note.text}<span>— {note.by}</span>
          <button disabled={isDeleting} onClick={() => onDelete(note.id)}>Delete</button>
        </li>
      ) : (
        <li class="note" data-note={note.id}>
          <input value={text} onInput={(event) => { text = event.currentTarget.value; }} />
          <button class="save" disabled={isDeleting} onClick={() => { onSave({ noteId: note.id, text }); editing = false; }}>{isSaving ? 'Saving' : 'Save'}</button>
        </li>
      )}
    </div>
  );
}
`;

const editNote = `
export const editNote = define.function({
  async post(_context, expeditionId: string, noteId: string, text: string) {
    await delay(300);
    const note = find(expeditionId).notes.find((item) => item.id === noteId);
    if (!note) throw new Error('Unknown note');
    note.text = text;
    return note;
  },
  updates: (_context, expeditionId) => ['notes', expeditionId],
});
`;

/** The fixture's page, with each row rendered by `Notes` and an optimistic edit. */
function appWithNoteComponents(): string {
  let app = NOTES_APP['App.tsx']!;
  app = "import { Notes } from './Notes';\n" + app.replace('postNote } from', 'postNote, editNote } from');
  app = app.replace('  const deleting = new Set<string>();', `  const deleting = new Set<string>();
  const saving = new Set<string>();
  const editSavedNote = optimistic({
    source: [notes, summary],
    action: ({ noteId, text }: { noteId: string; text: string }) => editNote(expeditionId, noteId, text),
    apply(input) { saving.add(input.noteId); return () => { saving.delete(input.noteId); }; },
    reconcile(_saved, input) { saving.delete(input.noteId); },
  });`);
  app = app.replace(/\{notes\.map\(\(note\) => \([\s\S]*?\)\)\}/,
    '{notes.map((note) => <Notes key={note.id} note={note} onDelete={removeSavedNote} onSave={editSavedNote} isSaving={saving.has(note.id)} isDeleting={deleting.has(note.id)} />)}');
  expect(app).toContain('<Notes key=');
  expect(app).toContain('editNote } from');
  return app;
}

it.skipIf(!chrome)('delivers add, edit and delete to isolated browsers with effect-owning note components', async () => {
  fixture = await mkdtemp(join(tmpdir(), 'memoized-dom-live-note-effects-'));
  server = await serveNotesApp(fixture, {
    'Notes.tsx': notes,
    'App.tsx': appWithNoteComponents(),
    'server/functions/notes.ts': NOTES_APP['server/functions/notes.ts']! + editNote,
  });
  const functions = join(fixture, 'server/functions/notes.ts');
  const address = server.origin;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, protocolTimeout: 15_000 });
  const errors: string[] = [];
  const effects = [0, 0];
  const snapshots = [0, 0];
  let stage = 'initial loading';
  try {
    // Separate contexts: two browsers that share no session or connection.
    const contexts = await Promise.all([browser.createBrowserContext(), browser.createBrowserContext()]);
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    for (const [index, page] of pages.entries()) {
      page.on('pageerror', (error) => errors.push(String(error)));
      page.on('console', (message) => {
        if (message.text().startsWith('note-effect:')) effects[index]++;
        if (message.text().startsWith('[memoized-dom:live] snapshot-applied')) snapshots[index]++;
      });
    }
    await Promise.all(pages.map((page) => page.goto(address, { waitUntil: 'domcontentloaded' })));
    for (const page of pages) {
      await page.waitForFunction(() => document.querySelectorAll('li.note').length === 2
        && document.querySelector('[data-live-status]')?.textContent?.includes('Live notes connected'), { timeout: 30_000 });
    }
    await waitFor(() => expect(effects.every((count) => count >= 4)).toBe(true));
    await waitFor(() => expect(snapshots.every((count) => count >= 2)).toBe(true), 10_000);
    // Hydration is followed by the first live snapshot, a real prop change. Once that
    // connection settles, nothing runs the effects again while the page is idle.
    await new Promise((done) => setTimeout(done, 1_200));
    const idle = effects.slice();
    await new Promise((done) => setTimeout(done, 400));
    expect(effects).toEqual(idle);

    stage = 'adding a note';
    const [writer, viewer] = pages;
    await writer!.bringToFront();
    await writer!.type('.note-form input', 'Cross-browser new note');
    await writer!.click('.note-form button');
    for (const page of pages) {
      await page.waitForFunction(() => document.querySelector('[data-note-count]')?.textContent?.includes('3 notes')
        && [...document.querySelectorAll('li.note')].some((node) => node.textContent?.includes('Cross-browser new note')), { timeout: 15_000, polling: 100 });
    }
    await writer!.waitForFunction(() => document.querySelector('.status-line')?.textContent?.includes('Note saved'), { timeout: 15_000 });
    const id = await writer!.$eval('ul.plain', (node) => [...node.querySelectorAll('li.note')]
      .find((row) => row.textContent?.includes('Cross-browser new note'))!.getAttribute('data-note'));
    const selector = `li[data-note="${id}"]`;

    stage = 'editing the note';
    // Double-click the row itself, not its Delete button.
    await writer!.$eval(selector, (node) => node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await writer!.waitForSelector(selector + ' input');
    await writer!.$eval(selector + ' input', (node) => {
      (node as HTMLInputElement).value = 'Edited across browsers';
      node.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await writer!.click(selector + ' .save');
    for (const page of pages) {
      await page.waitForFunction((value) => document.querySelector(`li[data-note="${value}"]`)?.textContent?.includes('Edited across browsers'),
        { timeout: 15_000, polling: 100 }, id);
    }

    stage = 'deleting the note';
    await writer!.click(selector + ' button');
    for (const page of pages) {
      await page.waitForFunction((value) => document.querySelector(`li[data-note="${value}"]`) === null
        && document.querySelector('[data-note-count]')?.textContent?.includes('2 notes'), { timeout: 15_000, polling: 100 }, id);
    }
    const settled = effects.slice();
    await new Promise((done) => setTimeout(done, 400));
    expect(effects).toEqual(settled);

    stage = 'reconnecting after a server edit';
    for (const page of pages) await page.evaluate(() => { document.documentElement.dataset.liveReloadProbe = 'kept'; });
    // Only server code changes: live connections must leave the replaced backend's hub, though
    // no browser module changed, and the pages must not reload.
    const updated = (await readFile(functions, 'utf8')).replace('return find(expeditionId).notes;',
      "return find(expeditionId).notes.map((note) => ({ ...note, by: note.by + ' reloaded' }));");
    expect(updated).toContain("by: note.by + ' reloaded'");
    await writeFile(functions, updated);
    await waitFor(async () => {
      const result = await (await fetch(address + '/_fn/notes/getNotes?expeditionId=ice-cores')).json() as Array<{ by: string }>;
      expect(result.some((note) => note.by.endsWith(' reloaded'))).toBe(true);
    }, 15_000);
    for (const page of pages) {
      await page.waitForFunction(() => [...document.querySelectorAll('li.note')].some((node) => node.textContent?.includes(' reloaded')),
        { timeout: 20_000, polling: 100 });
      expect(await page.evaluate(() => document.documentElement.dataset.liveReloadProbe)).toBe('kept');
    }

    stage = 'delivering changes after the server edit';
    await writer!.type('.note-form input', 'After the server edit');
    await writer!.click('.note-form button');
    for (const page of pages) {
      await page.waitForFunction(() => document.querySelector('[data-note-count]')?.textContent?.includes('3 notes')
        && [...document.querySelectorAll('li.note')].some((node) => node.textContent?.includes('After the server edit')), { timeout: 20_000, polling: 100 });
    }
    expect(errors).toEqual([]);
    expect(await viewer!.$eval('[data-note-count]', (node) => node.textContent)).toContain('3 notes');
  } catch (error) {
    throw new Error(`${stage}: ${String(error)}\nBrowser errors: ${errors.join('\n')}`);
  } finally {
    await closeBrowser(browser);
  }
}, 150_000);
