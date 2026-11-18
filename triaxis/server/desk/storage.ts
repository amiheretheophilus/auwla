import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

let connection: Database | undefined;

export function deskDatabase() {
  if (connection) return connection;

  const path = process.env.TRIAXIS_DESK_DB?.trim() || resolve('.local', 'analyst.sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  const database = new Database(path, { strict: true });
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS signal_drafts (
      analyst TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      fields TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS published_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace TEXT NOT NULL,
      draft_revision INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      published_at TEXT NOT NULL,
      published_by TEXT NOT NULL,
      UNIQUE (workspace, draft_revision)
    ) STRICT;
  `);

  connection = database;
  return database;
}
