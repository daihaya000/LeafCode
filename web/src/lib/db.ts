import Database from "better-sqlite3";
import { dbPath, ensureDataDir } from "./paths";

let db: Database.Database | null = null;

export type ProjectRow = {
  id: string;
  name: string;
  root_path: string;
  favorite: number;
  last_opened_at: string | null;
  created_at: string;
};

export type WorkspaceRow = {
  id: string;
  project_id: string;
  display_name: string;
  absolute_path: string;
  isolation: "current_folder" | "git_worktree" | "temporary_copy" | "devcontainer";
  base_branch: string | null;
  worktree_path: string | null;
  status: "active" | "merging" | "archived" | "orphaned";
  created_at: string;
};

export type SessionBindingRow = {
  workspace_id: string;
  opencode_session_id: string;
  title: string;
  updated_at: string;
};

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
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      favorite INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      absolute_path TEXT NOT NULL,
      isolation TEXT NOT NULL,
      base_branch TEXT,
      worktree_path TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_bindings (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      opencode_session_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, opencode_session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workspaces_project ON workspaces(project_id);
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

export function listProjects(): ProjectRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM projects
       ORDER BY favorite DESC, COALESCE(last_opened_at, created_at) DESC`,
    )
    .all() as ProjectRow[];
}

export function upsertProject(input: {
  name: string;
  rootPath: string;
  favorite?: boolean;
}): ProjectRow {
  const now = new Date().toISOString();
  const existing = getDb()
    .prepare("SELECT * FROM projects WHERE root_path = ?")
    .get(input.rootPath) as ProjectRow | undefined;
  if (existing) {
    getDb()
      .prepare(
        `UPDATE projects SET name = ?, favorite = ?, last_opened_at = ? WHERE id = ?`,
      )
      .run(
        input.name,
        input.favorite === undefined ? existing.favorite : input.favorite ? 1 : 0,
        now,
        existing.id,
      );
    return getDb().prepare("SELECT * FROM projects WHERE id = ?").get(existing.id) as ProjectRow;
  }
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO projects (id, name, root_path, favorite, last_opened_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.name, input.rootPath, input.favorite ? 1 : 0, now, now);
  addAllowedRoot(input.rootPath);
  return getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
}

export function listWorkspaces(projectId?: string): WorkspaceRow[] {
  if (projectId) {
    return getDb()
      .prepare(
        `SELECT * FROM workspaces WHERE project_id = ? ORDER BY created_at DESC`,
      )
      .all(projectId) as WorkspaceRow[];
  }
  return getDb()
    .prepare(`SELECT * FROM workspaces ORDER BY created_at DESC`)
    .all() as WorkspaceRow[];
}

export function listWorkspacesByStatus(
  status: WorkspaceRow["status"],
): WorkspaceRow[] {
  return getDb()
    .prepare(`SELECT * FROM workspaces WHERE status = ? ORDER BY created_at DESC`)
    .all(status) as WorkspaceRow[];
}

export function createWorkspace(input: {
  id?: string;
  projectId: string;
  displayName: string;
  absolutePath: string;
  isolation: "current_folder" | "git_worktree" | "temporary_copy" | "devcontainer";
  baseBranch?: string;
  worktreePath?: string;
}): WorkspaceRow {
  const id = input.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO workspaces
        (id, project_id, display_name, absolute_path, isolation, base_branch, worktree_path, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    )
    .run(
      id,
      input.projectId,
      input.displayName,
      input.absolutePath,
      input.isolation,
      input.baseBranch ?? null,
      input.worktreePath ?? null,
      now,
    );
  getDb()
    .prepare(`UPDATE projects SET last_opened_at = ? WHERE id = ?`)
    .run(now, input.projectId);
  return getDb().prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as WorkspaceRow;
}

export function bindSession(
  workspaceId: string,
  opencodeSessionId: string,
  title: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO session_bindings (workspace_id, opencode_session_id, title, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, opencode_session_id) DO UPDATE SET
         title = excluded.title,
         updated_at = excluded.updated_at`,
    )
    .run(workspaceId, opencodeSessionId, title, new Date().toISOString());
}

export function getWorkspace(id: string): WorkspaceRow | undefined {
  return getDb().prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as
    | WorkspaceRow
    | undefined;
}

export function setWorkspaceStatus(
  id: string,
  status: WorkspaceRow["status"],
): void {
  getDb().prepare("UPDATE workspaces SET status = ? WHERE id = ?").run(status, id);
}

export function deleteWorkspace(id: string): WorkspaceRow | undefined {
  const row = getWorkspace(id);
  if (!row) return undefined;
  getDb().prepare("DELETE FROM session_bindings WHERE workspace_id = ?").run(id);
  getDb().prepare("DELETE FROM workspaces WHERE id = ?").run(id);
  return row;
}
