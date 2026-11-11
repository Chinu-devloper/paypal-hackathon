import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  status TEXT NOT NULL,
  is_processing INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_project ON items(project_id, sort_order);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  item_id TEXT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  item_id TEXT,
  ts TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

const globalForDb = globalThis as unknown as { __milestoneDb?: Db };

function openDatabase(): Db {
  const configured = process.env.DATABASE_PATH?.trim();
  const file = configured || path.join(process.cwd(), "data", "milestoneos.db");
  let db: Db;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file);
    db.pragma("journal_mode = WAL");
  } catch (err) {
    console.warn(`[db] Could not open ${file} (${(err as Error).message}); using in-memory database.`);
    db = new Database(":memory:");
  }
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function getDb(): Db {
  if (!globalForDb.__milestoneDb) {
    globalForDb.__milestoneDb = openDatabase();
  }
  return globalForDb.__milestoneDb;
}
