// SQLite storage using Node's built-in driver (node:sqlite, Node 22.13+).
// Rows are JSON, so new or removed CSV columns never need ALTER TABLE.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS books (
    row_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    data        TEXT NOT NULL,              -- JSON: {"title":"...","shelf":"A",...}
    search_text TEXT NOT NULL,              -- normalized text of searchable fields
    title_text  TEXT NOT NULL DEFAULT '',   -- normalized title, for ranking/sorting
    dataset_id  INTEGER NOT NULL,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS books_title ON books (title_text);

  CREATE TABLE IF NOT EXISTS fields (
    key           TEXT PRIMARY KEY,
    label         TEXT NOT NULL,
    type          TEXT NOT NULL,            -- text | number | boolean | date
    searchable    INTEGER DEFAULT 1,
    show_in_card  INTEGER DEFAULT 1,
    is_location   INTEGER DEFAULT 0,
    role          TEXT,                     -- title | author | category | availability | null
    sort_order    INTEGER DEFAULT 0,
    active        INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS datasets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    filename    TEXT,
    mode        TEXT,
    row_count   INTEGER,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notices (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`;

export function openDatabase(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  // Columns added after the first release.
  try {
    db.exec("ALTER TABLE notices ADD COLUMN kind TEXT NOT NULL DEFAULT 'UPDATE'");
  } catch {
    /* already there */
  }
  return db;
}

/** Run `fn` inside a transaction; roll back on error or when `rollback` is true. */
export function transaction(db, fn, { rollback = false } = {}) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec(rollback ? "ROLLBACK" : "COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** JSON path for a field key; keys are letters/digits/underscores only. */
export const jsonPath = (key) => `$."${key}"`;
