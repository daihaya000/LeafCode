import Database from "better-sqlite3";
import { isSafeOpenCodeSessionId } from "./opencode-id";
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
  // Enforce foreign keys so ON DELETE CASCADE (workspaces/goal_loops/session_bindings
  // → projects/workspaces) actually fires. better-sqlite3 defaults this off.
  db.pragma("foreign_keys = ON");
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
    CREATE TABLE IF NOT EXISTS goal_loops (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      opencode_session_id TEXT NOT NULL,
      status TEXT NOT NULL,
      goal TEXT NOT NULL,
      acceptance TEXT NOT NULL DEFAULT '[]',
      max_turns INTEGER NOT NULL DEFAULT 10,
      turn_count INTEGER NOT NULL DEFAULT 0,
      last_message_id TEXT,
      last_prompt_at TEXT,
      agent TEXT,
      provider_id TEXT,
      model_id TEXT,
      variant TEXT,
      progress TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '',
      blocked_reason TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 0,
      turn_kind TEXT NOT NULL DEFAULT 'goal',
      pause_reason TEXT NOT NULL DEFAULT '',
      rejected_claims INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workspaces_project ON workspaces(project_id);
    CREATE INDEX IF NOT EXISTS idx_goal_loops_workspace ON goal_loops(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_goal_loops_status ON goal_loops(status);
  `);
  const goalLoopColumns = db
    .prepare("PRAGMA table_info(goal_loops)")
    .all() as { name: string }[];
  const hasGoalLoopColumn = (name: string): boolean =>
    goalLoopColumns.some((column) => column.name === name);
  if (!hasGoalLoopColumn("revision")) {
    db.exec("ALTER TABLE goal_loops ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
  }
  // See docs/specs/goal-loop.md. These three columns replace state that used to
  // be inferred from the human-readable `error` text or from the tail of the
  // `progress` array (which is truncated to 50 entries and therefore unusable
  // as a source of truth).
  if (!hasGoalLoopColumn("turn_kind")) {
    db.exec("ALTER TABLE goal_loops ADD COLUMN turn_kind TEXT NOT NULL DEFAULT 'goal'");
  }
  if (!hasGoalLoopColumn("pause_reason")) {
    db.exec("ALTER TABLE goal_loops ADD COLUMN pause_reason TEXT NOT NULL DEFAULT ''");
  }
  if (!hasGoalLoopColumn("rejected_claims")) {
    db.exec("ALTER TABLE goal_loops ADD COLUMN rejected_claims INTEGER NOT NULL DEFAULT 0");
  }
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
    // Only update last_opened_at when this is a genuine "open" (no explicit
    // favorite toggle). Toggling favorite alone must not disturb the sort order.
    const shouldUpdateLastOpened = input.favorite === undefined;
    const newFavorite =
      input.favorite === undefined ? existing.favorite : input.favorite ? 1 : 0;
    if (shouldUpdateLastOpened) {
      getDb()
        .prepare(
          `UPDATE projects SET name = ?, favorite = ?, last_opened_at = ? WHERE id = ?`,
        )
        .run(input.name, newFavorite, now, existing.id);
    } else {
      getDb()
        .prepare(`UPDATE projects SET name = ?, favorite = ? WHERE id = ?`)
        .run(input.name, newFavorite, existing.id);
    }
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
  updatedAt?: string,
): void {
  if (!isSafeOpenCodeSessionId(opencodeSessionId)) {
    throw new Error(
      `unsafe opencode_session_id: ${JSON.stringify(opencodeSessionId)}`,
    );
  }
  getDb()
    .prepare(
      `INSERT INTO session_bindings (workspace_id, opencode_session_id, title, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, opencode_session_id) DO UPDATE SET
         title = excluded.title,
         updated_at = excluded.updated_at`,
    )
    .run(workspaceId, opencodeSessionId, title, updatedAt ?? new Date().toISOString());
}

/** Update only the title of an existing binding, preserving updated_at. */
export function updateSessionTitle(
  workspaceId: string,
  opencodeSessionId: string,
  title: string,
): boolean {
  const info = getDb()
    .prepare(
      `UPDATE session_bindings SET title = ?
       WHERE workspace_id = ? AND opencode_session_id = ?`,
    )
    .run(title, workspaceId, opencodeSessionId);
  return info.changes > 0;
}

export function touchSessionActivity(
  workspaceId: string,
  opencodeSessionId: string,
  updatedAt = new Date().toISOString(),
): boolean {
  if (!isSafeOpenCodeSessionId(opencodeSessionId)) return false;
  const info = getDb()
    .prepare(
      `UPDATE session_bindings SET updated_at = ?
       WHERE workspace_id = ? AND opencode_session_id = ?`,
    )
    .run(updatedAt, workspaceId, opencodeSessionId);
  return info.changes > 0;
}

/** All session bindings for a workspace (newest first). */
export function listSessionBindings(workspaceId: string): SessionBindingRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM session_bindings WHERE workspace_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(workspaceId) as SessionBindingRow[];
}

/**
 * Insert a workspace row verbatim (preserving id/status/created_at), skipping
 * when the id already exists. Used to restore workspaces from a project-local
 * manifest without clobbering live rows.
 */
export function importWorkspaceRow(row: {
  id: string;
  projectId: string;
  displayName: string;
  absolutePath: string;
  isolation: WorkspaceRow["isolation"];
  baseBranch?: string | null;
  worktreePath?: string | null;
  status?: WorkspaceRow["status"];
  createdAt?: string;
}): boolean {
  const existing = getWorkspace(row.id);
  if (existing) return false;
  getDb()
    .prepare(
      `INSERT INTO workspaces
        (id, project_id, display_name, absolute_path, isolation, base_branch, worktree_path, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.projectId,
      row.displayName,
      row.absolutePath,
      row.isolation,
      row.baseBranch ?? null,
      row.worktreePath ?? null,
      row.status ?? "active",
      row.createdAt ?? new Date().toISOString(),
    );
  return true;
}

export type WorkspaceJoinedRow = WorkspaceRow & {
  project_name: string;
  project_root: string;
};

export function listWorkspacesJoined(): WorkspaceJoinedRow[] {
  return getDb()
    .prepare(
      `SELECT w.*, p.name AS project_name, p.root_path AS project_root
       FROM workspaces w JOIN projects p ON p.id = w.project_id
       ORDER BY w.created_at DESC`,
    )
    .all() as WorkspaceJoinedRow[];
}

/** Latest session binding per workspace. */
export function latestBindings(): Map<string, SessionBindingRow> {
  const rows = getDb()
    .prepare(`SELECT * FROM session_bindings ORDER BY updated_at ASC`)
    .all() as SessionBindingRow[];
  const map = new Map<string, SessionBindingRow>();
  for (const row of rows) map.set(row.workspace_id, row);
  return map;
}

export function touchProjectOpened(projectId: string): void {
  getDb()
    .prepare(`UPDATE projects SET last_opened_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), projectId);
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

export function getProject(id: string): ProjectRow | undefined {
  return getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
}

/** Remove project row. Caller must destroy workspaces first. */
export function deleteProject(id: string): ProjectRow | undefined {
  const row = getProject(id);
  if (!row) return undefined;
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
  return row;
}

export function removeAllowedRoot(rootPath: string): void {
  getDb().prepare("DELETE FROM allowed_roots WHERE path = ?").run(rootPath);
}
