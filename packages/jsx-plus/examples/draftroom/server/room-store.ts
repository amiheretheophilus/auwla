import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { prepareShapes } from '../model/edits';
import type { Project } from '../model/types';
import { mergeProject } from '../rooms/merge';
import { validCode, type EditResult, type ProjectPatch, type RoomCreated, type RoomSnapshot } from '../rooms/protocol';
import { assertBoard, assertPatch, validVisitor } from './room-validation';

interface Row {
  revision: number;
  project: string;
}

const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
let db: Database | undefined;

function database(): Database {
  if (db !== undefined) return db;

  const root = join(process.env.DRAFTROOM_ROOT ?? process.cwd(), '.memoized');
  mkdirSync(root, { recursive: true });
  db = new Database(join(root, 'rooms.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 2500;
    CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, project TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS room_edits (
      room TEXT NOT NULL, edit TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY (room, edit)
    );
  `);
  return db;
}

export function roomExists(code: string): boolean {
  return validCode(code) && database().query('SELECT 1 FROM rooms WHERE id = ?').get(code) !== null;
}

export function readRoom(code: string): RoomSnapshot | null {
  if (!validCode(code)) return null;
  const row = database().query<Row, [string]>('SELECT revision, project FROM rooms WHERE id = ?').get(code);
  return row === null ? null : { revision: row.revision, project: JSON.parse(row.project) as Project };
}

export function createRoom(project: Project): RoomCreated {
  assertBoard(project);
  const normalized = { ...project, pages: project.pages.map(page => ({ ...page, shapes: prepareShapes(page.shapes) })) };
  const serialized = JSON.stringify(normalized);
  const insert = database().query('INSERT OR IGNORE INTO rooms VALUES (?, 0, ?)');

  for (let attempt = 0; attempt < 10; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    const id = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
    if (insert.run(id, serialized).changes === 1) return { id, revision: 0, project: normalized };
  }
  throw new Error('Draftroom could not allocate a room ID');
}

export function writeRoom(code: string, id: string, patch: ProjectPatch): EditResult | null {
  if (!validCode(code) || !validVisitor(id)) return null;
  assertPatch(patch);
  const store = database();

  // Check the latest committed version and persist the whole edit under one SQLite write lock.
  return store.transaction((): EditResult | null => {
    const current = readRoom(code);
    if (current === null) return null;

    const receipt = store.query('SELECT revision FROM room_edits WHERE room = ? AND edit = ?').get(code, id);
    if (receipt !== null) return { accepted: true, snapshot: current };

    const project = mergeProject(current.project, patch);
    if (project === undefined) return { accepted: false, snapshot: current };
    assertBoard(project);

    const revision = current.revision + 1;
    store.query('UPDATE rooms SET revision = ?, project = ? WHERE id = ?').run(revision, JSON.stringify(project), code);
    store.query('INSERT INTO room_edits VALUES (?, ?, ?)').run(code, id, revision);
    store.query('DELETE FROM room_edits WHERE room = ? AND revision < ?').run(code, revision - 1000);
    return { accepted: true, snapshot: { revision, project } };
  }).immediate();
}
