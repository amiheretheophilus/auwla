/**
 * A small live notes app for the browser tests, written into a fresh folder and served by the
 * dev server in this process. Tests never run an example (wiki/rules.md, rule 16): this fixture
 * holds only what the tests read, and a test changes it by passing its own files.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDevServer, type NativeDevServer } from '../../src/dev';
import memoizedDom from '../../src';

const repository = resolve(import.meta.dirname, '../../../..');

/** Two expeditions: `ice-cores` with two notes, `canopy` with one. */
const store = `
export interface Note { id: string; text: string; by: string }
export const expeditions = [
  { id: 'ice-cores', name: 'Ice cores', notes: [
    { id: 'n1', text: 'Drill site reached', by: 'Ada' },
    { id: 'n2', text: 'First core sample', by: 'Grace' },
  ] as Note[] },
  { id: 'canopy', name: 'Canopy', notes: [{ id: 'n3', text: 'Ropes set', by: 'Lin' }] as Note[] },
];
let sequence = 10;
export function find(id: string) {
  const expedition = expeditions.find((item) => item.id === id);
  if (expedition === undefined) throw new Error('Unknown expedition');
  return expedition;
}
export function nextId(): string { return 'n' + String(++sequence); }
export const delay = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds));
`;

const functions = `
import { define } from '../define';
import { delay, expeditions, find, nextId } from '../store';

export const getExpeditions = define.function({
  async get() {
    return expeditions.map((item) => ({ id: item.id, name: item.name, notes: item.notes.length }));
  },
  live: () => ['notes'],
});

export const getNotes = define.function({
  async get(_context, expeditionId: string) {
    return find(expeditionId).notes;
  },
  live: (_context, expeditionId) => ['notes', expeditionId],
});

export const getSummary = define.function({
  async get(_context, expeditionId: string) {
    return { noteCount: find(expeditionId).notes.length };
  },
  live: (_context, expeditionId) => ['notes', expeditionId],
});

export const postNote = define.function({
  async post({ state }, expeditionId: string, text: string) {
    if (text.toLowerCase().includes('spam')) throw new Error('Note rejected by content filter');
    await delay(300);
    const note = { id: nextId(), text, by: state.visitor };
    find(expeditionId).notes.push(note);
    return note;
  },
  updates: (_context, expeditionId) => ['notes', expeditionId],
});

export const deleteNote = define.function({
  async delete(_context, expeditionId: string, noteId: string) {
    const notes = find(expeditionId).notes;
    const index = notes.findIndex((note) => note.id === noteId);
    if (index === -1) throw new Error('Unknown note');
    return notes.splice(index, 1)[0]!;
  },
  updates: (_context, expeditionId) => ['notes', expeditionId],
});
`;

/** The overview (counts, live) and the open expedition's notes, with optimistic adds and deletes. */
const app = `
import { $read, type ResolvedValue } from '@memoized-dom/data';
import { optimistic } from '@memoized-dom/utils';
import { deleteNote, getNotes, getSummary, postNote } from '#server-functions';
import { Overview } from './Overview';

function Detail({ expeditionId }: { expeditionId: string }) {
  const notes = getNotes(expeditionId);
  const summary = getSummary(expeditionId);
  // A POST returns a promise; \`$read\` makes it a request \`$track\` can follow. \`posted\` says
  // whether there is one: comparing the request to null would read its value, which waits.
  let lastPost = null as ResolvedValue<unknown> | null;
  let posted = false;
  const deleting = new Set<string>();
  const nodes = { input: null as HTMLInputElement | null };

  const saveNote = optimistic({
    source: [notes, summary],
    action: (text: string) => postNote(expeditionId, text),
    apply(text, operationId) {
      notes.push({ id: operationId, text, by: 'me' });
      summary.noteCount++;
      return () => {
        const index = notes.findIndex((note) => note.id === operationId);
        if (index !== -1) notes.splice(index, 1);
        summary.noteCount--;
      };
    },
    reconcile(saved, _text, operationId) {
      const index = notes.findIndex((note) => note.id === operationId);
      if (index !== -1) notes.splice(index, 1, saved);
    },
  });

  const removeSavedNote = optimistic({
    source: [notes, summary],
    action: (noteId: string) => deleteNote(expeditionId, noteId),
    apply(noteId) {
      deleting.add(noteId);
      return () => { deleting.delete(noteId); };
    },
    reconcile(_removed, noteId) {
      const index = notes.findIndex((note) => note.id === noteId);
      if (index !== -1) { notes.splice(index, 1); summary.noteCount--; }
      deleting.delete(noteId);
    },
  });

  function addNote() {
    const input = nodes.input;
    if (input === null || input.value.trim() === '') return;
    const text = input.value;
    input.value = '';
    lastPost = $read(saveNote(text));
    posted = true;
  }

  return (
    <article>
      <span data-note-count>{summary.noteCount} notes</span>
      <p data-live-status>{$track(notes).streaming ? 'Live notes connected' : 'Live notes disconnected'}</p>
      <div class="note-form">
        <input ref={nodes.input} />
        <button onClick={addNote}>Add note</button>
      </div>
      {posted ? (
        <p class="status-line">
          {$track(lastPost).pending ? 'Saving note' : $track(lastPost).error !== null
            ? 'Note failed: ' + $track(lastPost).error?.message : 'Note saved'}
        </p>
      ) : null}
      <ul class="plain">
        {notes.map((note) => (
          <li key={note.id} class="note" data-note={note.id}>
            {note.text} <span>— {note.by}</span>
            <button disabled={deleting.has(note.id)} onClick={() => removeSavedNote(note.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function App() {
  let open = 'ice-cores';
  return (
    <main>
      <Overview />
      <button class="open-canopy" onClick={() => { open = 'canopy'; }}>Canopy</button>
      <Detail key={open} expeditionId={open} />
    </main>
  );
}
`;

const overview = `
import { getExpeditions } from '#server-functions';
export function Overview() {
  const expeditions = getExpeditions();
  return (
    <ul class="overview">
      {expeditions.map((item) => <li key={item.id} class="expedition" data-expedition={item.id}>{item.name}: <b>{item.notes} notes</b></li>)}
    </ul>
  );
}
`;

export const NOTES_APP: Readonly<Record<string, string>> = {
  'index.html': '<!doctype html><html><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/main.ts"></script></body></html>',
  'main.ts': "import { mount } from '@memoized-dom/runtime'; import { App } from './App'; mount('root', App);",
  'server/define.ts': "import { createDefine } from '@memoized-dom/server'; export const define = createDefine<{ visitor: string }>();",
  'server/store.ts': store,
  'server/functions/notes.ts': functions,
  'server.ts': "import { serve } from '@memoized-dom/server'; import { define } from './server/define'; import { App } from './App'; const app = serve({ define, state: () => ({ visitor: 'anonymous' }) }); app.ssr(App); export default app;",
  'App.tsx': app,
  'Overview.tsx': overview,
};

/** Write the app, with `changes` replacing or adding files, and serve it in development. */
export async function serveNotesApp(directory: string, changes: Record<string, string> = {}): Promise<NativeDevServer> {
  for (const [name, source] of Object.entries({ ...NOTES_APP, ...changes })) {
    const file = resolve(directory, name);
    await mkdir(resolve(file, '..'), { recursive: true });
    await writeFile(file, source);
  }
  const packages = ['runtime/server', 'runtime/hot', 'runtime/hydrate-program', 'runtime/hydrate', 'runtime', 'data/internal', 'data',
    'router/internal', 'router', 'server/internal', 'server/router', 'server', 'utils', 'adapters/bun'];
  const alias = packages.map((name) => ({
    find: new RegExp(`^@memoized-dom/${name}$`),
    replacement: resolve(repository, 'packages', name.split('/')[0]!, 'src',
      name.includes('/') ? (name.endsWith('/router') ? 'http-router' : name.split('/')[1]!) + '.ts' : 'index.ts'),
  }));
  return createDevServer({
    root: directory, configFile: false, logLevel: 'silent', resolve: { alias },
    plugins: [memoizedDom({ clientEntry: 'main.ts', serverEntry: 'server.ts', server: 'server' })],
    server: { host: '127.0.0.1', port: 0 },
  });
}
