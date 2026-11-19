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

    -- The single shared draft the desk used before analyses. Nothing reads it now; it stays so
    -- an existing local database keeps its data.
    CREATE TABLE IF NOT EXISTS signal_drafts (
      analyst TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      fields TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    -- One row per trade idea. The verdict is stored beside the fields so the list can filter
    -- without running the checks again. A posted analysis is one with a published_signals row
    -- whose workspace is 'analysis:<id>'.
    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      fields TEXT NOT NULL,
      verdict TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS analyses_by_update ON analyses (updated_at DESC);

    -- A member's claim of payment for a plan. An admin decides it once: approving it adds
    -- the plan's time to each axis it covers (subscriptions below).
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      axes TEXT NOT NULL,
      months INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      method TEXT NOT NULL,
      reference TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL,
      decided_by TEXT,
      decided_at TEXT
    ) STRICT;

    CREATE INDEX IF NOT EXISTS payments_by_user ON payments (user_id, created_at DESC);

    -- One stretch of access to one axis. A member holds an axis while any of their rows covers
    -- the present moment. A renewal starts where the current stretch ends, so time is added on
    -- top rather than restarting the clock.
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      axis TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      source TEXT NOT NULL,
      payment_id INTEGER
    ) STRICT;

    CREATE INDEX IF NOT EXISTS subscriptions_by_user ON subscriptions (user_id, axis, expires_at);

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
