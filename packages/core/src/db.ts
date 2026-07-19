import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { loadConfig } from "./config.js";

let db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS watches (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  url            TEXT NOT NULL,
  mode           TEXT NOT NULL DEFAULT 'cheapest',
  match_criteria TEXT,
  target_price   REAL,
  cron           TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_points (
  id           TEXT PRIMARY KEY,
  watch_id     TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  checked_at   TEXT NOT NULL,
  price        REAL,
  currency     TEXT,
  offer        TEXT,
  offers_count INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  changed      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_price_points_watch
  ON price_points(watch_id, checked_at);
`;

export function getDb(): Database.Database {
  if (db) return db;
  const { databasePath } = loadConfig();
  const path = resolve(databasePath);
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Add columns introduced after a database was first created. */
function migrate(database: Database.Database): void {
  const cols = database
    .prepare("PRAGMA table_info(watches)")
    .all() as { name: string }[];
  if (!cols.some((c) => c.name === "target_price")) {
    database.exec("ALTER TABLE watches ADD COLUMN target_price REAL");
  }
}

/** For tests / graceful shutdown. */
export function closeDb(): void {
  db?.close();
  db = null;
}
