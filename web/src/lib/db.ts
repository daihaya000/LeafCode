import Database from "better-sqlite3";
import { dbPath, ensureDataDir } from "./paths";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  ensureDataDir();
  db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS allowed_roots (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function listAllowedRoots(): string[] {
  const rows = getDb()
    .prepare("SELECT path FROM allowed_roots ORDER BY created_at DESC")
    .all() as { path: string }[];
  return rows.map((r) => r.path);
}

export function addAllowedRoot(rootPath: string): void {
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO allowed_roots (id, path, created_at) VALUES (?, ?, ?)
       ON CONFLICT(path) DO NOTHING`,
    )
    .run(id, rootPath, new Date().toISOString());
}
