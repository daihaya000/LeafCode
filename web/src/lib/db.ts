import Database from "better-sqlite3";
import { isSafeOpenCodeSessionId } from "./opencode-id";
import { dbPath, ensureDataDir } from "./paths";
import type { TaskExecutionMode } from "./types";
import path from "node:path";

let db: Database.Database | null = null;

export type ProjectRow = {
  id: string;
  name: string;
  root_path: string;
  favorite: number;
  archived: number;
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
  execution_mode: TaskExecutionMode;
  primary_session_id: string | null;
  revision: number;
  created_at: string;
};

export type SessionBindingRow = {
  workspace_id: string;
  opencode_session_id: string;
  title: string;
  favorite: number;
  updated_at: string;
};

export type WorkflowRunRow = {
  id: string;
  workspace_id: string;
  template_key: string;
  definition_snapshot: string;
  task_context_snapshot: string;
  status: string;
  cycle_count: number;
  max_cycles: number;
  primary_node_key: string;
  revision: number;
  pause_reason: string;
  error: string;
  created_at: string;
  updated_at: string;
};

export type WorkflowNodeRunRow = {
  id: string;
  workflow_run_id: string;
  node_key: string;
  kind: string;
  config: string;
  latest_attempt_no: number;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type WorkflowNodeAttemptRow = {
  id: string;
  node_run_id: string;
  attempt_no: number;
  opencode_session_id: string | null;
  session_create_marker: string | null;
  status: string;
  outcome: string | null;
  config_snapshot: string;
  input: string | null;
  result: string | null;
  error: string;
  last_message_id: string | null;
  prompt_marker: string | null;
  prompt_template_version: string | null;
  output_schema_version: string | null;
  input_hash: string | null;
  input_truncated: string;
  output_mode: string;
  prompt_generated_at: string | null;
  dispatch_status: string;
  base_head: string | null;
  start_head: string | null;
  finish_head: string | null;
  dirty_fingerprint: string | null;
  usage_snapshot: string;
  revision: number;
  started_at: string | null;
  finished_at: string | null;
};

export type WorkflowArtifactRow = {
  id: string;
  workflow_run_id: string;
  node_attempt_id: string | null;
  kind: string;
  label: string;
  opaque_ref: string | null;
  expires_at: string | null;
  metadata: string;
  created_at: string;
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
      archived INTEGER NOT NULL DEFAULT 0,
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
      execution_mode TEXT NOT NULL DEFAULT 'standard',
      primary_session_id TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_bindings (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      opencode_session_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      favorite INTEGER NOT NULL DEFAULT 0,
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
      pause_requested INTEGER NOT NULL DEFAULT 0,
      force_full_run INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      template_key TEXT NOT NULL,
      definition_snapshot TEXT NOT NULL,
      task_context_snapshot TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      cycle_count INTEGER NOT NULL DEFAULT 0,
      max_cycles INTEGER NOT NULL DEFAULT 3,
      primary_node_key TEXT NOT NULL DEFAULT 'implement_ui',
      revision INTEGER NOT NULL DEFAULT 0,
      pause_reason TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_node_runs (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      node_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      latest_attempt_no INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workflow_run_id, node_key)
    );
    CREATE TABLE IF NOT EXISTS workflow_node_attempts (
      id TEXT PRIMARY KEY,
      node_run_id TEXT NOT NULL REFERENCES workflow_node_runs(id) ON DELETE CASCADE,
      attempt_no INTEGER NOT NULL,
      opencode_session_id TEXT,
      session_create_marker TEXT,
      status TEXT NOT NULL,
      outcome TEXT,
      config_snapshot TEXT NOT NULL DEFAULT '{}',
      input TEXT,
      result TEXT,
      error TEXT NOT NULL DEFAULT '',
      last_message_id TEXT,
      prompt_marker TEXT,
      prompt_template_version TEXT,
      output_schema_version TEXT,
      input_hash TEXT,
      input_truncated TEXT NOT NULL DEFAULT '{"omittedCount":0}',
      output_mode TEXT NOT NULL DEFAULT 'fenced_json',
      prompt_generated_at TEXT,
      dispatch_status TEXT NOT NULL DEFAULT 'not_sent',
      base_head TEXT,
      start_head TEXT,
      finish_head TEXT,
      dirty_fingerprint TEXT,
      usage_snapshot TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      finished_at TEXT,
      UNIQUE (node_run_id, attempt_no)
    );
    CREATE TABLE IF NOT EXISTS workflow_artifacts (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      node_attempt_id TEXT REFERENCES workflow_node_attempts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      opaque_ref TEXT,
      expires_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_graphs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      schema_version TEXT NOT NULL,
      registry_version TEXT NOT NULL,
      graph_revision INTEGER NOT NULL DEFAULT 1,
      viewport TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id),
      CHECK (graph_revision >= 1)
    );
    CREATE TABLE IF NOT EXISTS workflow_graph_nodes (
      graph_id TEXT NOT NULL REFERENCES workflow_graphs(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      node_type_version INTEGER NOT NULL,
      label TEXT NOT NULL,
      position_x REAL NOT NULL,
      position_y REAL NOT NULL,
      config TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
      presentation TEXT,
      node_revision INTEGER NOT NULL DEFAULT 1 CHECK (node_revision >= 1),
      PRIMARY KEY (graph_id, id),
      CHECK (position_x BETWEEN -100000 AND 100000),
      CHECK (position_y BETWEEN -100000 AND 100000),
      CHECK (node_type_version >= 1)
    );
    CREATE TABLE IF NOT EXISTS workflow_graph_edges (
      graph_id TEXT NOT NULL REFERENCES workflow_graphs(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      source_handle TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      target_handle TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('dependency', 'success', 'feedback', 'control')),
      label TEXT,
      edge_revision INTEGER NOT NULL DEFAULT 1 CHECK (edge_revision >= 1),
      PRIMARY KEY (graph_id, id),
      FOREIGN KEY (graph_id, source_node_id)
        REFERENCES workflow_graph_nodes(graph_id, id) ON DELETE CASCADE,
      FOREIGN KEY (graph_id, target_node_id)
        REFERENCES workflow_graph_nodes(graph_id, id) ON DELETE CASCADE
    );
    -- Server-side hang watchdog. One row per session = the newest turn that is
    -- eligible for automatic stop + single resume.
    -- See docs/specs/hang-watchdog-server-side.md.
    CREATE TABLE IF NOT EXISTS session_hang_watches (
      session_id TEXT PRIMARY KEY,
      directory TEXT NOT NULL,
      request_path TEXT NOT NULL,
      request_body TEXT NOT NULL,
      request_timeout_ms INTEGER NOT NULL,
      resume_allowed INTEGER NOT NULL DEFAULT 1,
      started_at INTEGER NOT NULL,
      last_progress_at INTEGER NOT NULL,
      progress_fingerprint TEXT NOT NULL DEFAULT '',
      retry_used INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'armed' CHECK (state IN ('armed', 'resolving')),
      updated_at INTEGER NOT NULL
    );
    -- Session-crossing persistent memory. See docs/specs/memory-layer.md.
    -- created_at / updated_at are epoch milliseconds (INTEGER) so the search
    -- bump and ordering play well with the FTS layer.
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,              -- 'fact' | 'preference' | 'lesson' | 'reference'
      content TEXT NOT NULL,
      source_session_id TEXT,
      provenance TEXT NOT NULL,        -- 'agent' | 'auto-extract' | 'auto-extract-retrospective' | 'manual'
      approved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_used_at INTEGER,
      use_count INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_memories_ws ON memories(workspace_id, approved);
    CREATE TABLE IF NOT EXISTS memory_audit_log (
      id INTEGER PRIMARY KEY,
      action TEXT NOT NULL,
      workspace_id TEXT,
      memory_id TEXT,
      session_id TEXT,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_audit_workspace
      ON memory_audit_log(workspace_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS memory_extraction_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      source_session_id TEXT NOT NULL,
      assistant_message_id TEXT,
      trigger_type TEXT NOT NULL CHECK (trigger_type IN ('assistant-completed', 'goal-completed', 'idle', 'manual')),
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
      created_count INTEGER NOT NULL DEFAULT 0,
      saved_count INTEGER NOT NULL DEFAULT 0,
      candidate_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      read_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_memory_extraction_runs_workspace
      ON memory_extraction_runs(workspace_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_extraction_runs_unread
      ON memory_extraction_runs(workspace_id, read_at, started_at DESC);
    -- FTS5 access path. id is carried as an UNINDEXED column (TEXT PK does not
    -- align with SQLite rowid), so the sync never relies on rowid.
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, content);
    DROP TRIGGER IF EXISTS memories_fts_insert;
    CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(id, content) VALUES (new.id, new.content);
    END;
    DROP TRIGGER IF EXISTS memories_fts_update;
    CREATE TRIGGER memories_fts_update AFTER UPDATE ON memories BEGIN
      UPDATE memories_fts SET content = new.content WHERE id = new.id;
    END;
    DROP TRIGGER IF EXISTS memories_fts_delete;
    CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
      DELETE FROM memories_fts WHERE id = old.id;
    END;
    -- Idle-extraction ledger: which (workspace, session) pairs have already been
    -- extracted by the idle sweep (docs/specs/memory-layer.md 「自動抽出」).
    -- Deliberately NOT keyed to source content so a session is extracted at most
    -- once for its lifetime, preventing duplicate background work.
    CREATE TABLE IF NOT EXISTS memory_idle_extracts (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      extracted_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, session_id)
    );
    -- Assistant-message extraction ledger. Claims are short-lived so a
    -- crashed/aborted extraction can be retried, while completed rows make
    -- duplicate global-event deliveries idempotent.
    CREATE TABLE IF NOT EXISTS memory_assistant_extracts (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      assistant_message_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_flight'
        CHECK (status IN ('in_flight', 'completed')),
      claimed_at INTEGER NOT NULL,
      extracted_at INTEGER,
      PRIMARY KEY (workspace_id, session_id, assistant_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_assistant_extracts_status
      ON memory_assistant_extracts(status, claimed_at);
    CREATE TABLE IF NOT EXISTS memory_session_injections (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      injected_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_session_injections_workspace
      ON memory_session_injections(workspace_id, injected_at DESC);
    -- Collaboration-context snapshot dedupe. One row per (workspace, session):
    -- the last injected peer/file snapshot and its fingerprint, so unchanged
    -- peer state is not re-injected on every prompt_async.
    CREATE TABLE IF NOT EXISTS collaboration_snapshots (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL DEFAULT '',
      snapshot TEXT NOT NULL DEFAULT '',
      injected_at INTEGER NOT NULL,
      compacted_at INTEGER,
      PRIMARY KEY (workspace_id, session_id)
    );
    -- Session-level compaction lock shared by all WebUI tabs/processes.
    -- Expired rows are removed atomically by tryAcquireSessionCompactionLock.
    CREATE TABLE IF NOT EXISTS session_compaction_locks (
      session_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_compaction_locks_expiry
      ON session_compaction_locks(expires_at);
    CREATE INDEX IF NOT EXISTS idx_workspaces_project ON workspaces(project_id);
    CREATE INDEX IF NOT EXISTS idx_goal_loops_workspace ON goal_loops(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_goal_loops_status ON goal_loops(status);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workspace ON workflow_runs(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
    CREATE INDEX IF NOT EXISTS idx_workflow_node_runs_workflow ON workflow_node_runs(workflow_run_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_node_attempts_node ON workflow_node_attempts(node_run_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_attempt ON workflow_artifacts(node_attempt_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_graphs_workspace ON workflow_graphs(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_graph_nodes_graph ON workflow_graph_nodes(graph_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_graph_edges_graph ON workflow_graph_edges(graph_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_one_active
      ON workflow_runs(workspace_id)
      WHERE status NOT IN ('completed', 'failed', 'stopped', 'detached');
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_attempts_one_active
      ON workflow_node_attempts(node_run_id)
      WHERE status IN ('creating_session', 'dispatching', 'running');
  `);
  const workspaceColumns = db
    .prepare("PRAGMA table_info(workspaces)")
    .all() as { name: string }[];
  const hasWorkspaceColumn = (name: string): boolean =>
    workspaceColumns.some((column) => column.name === name);
  if (!hasWorkspaceColumn("execution_mode")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'standard'");
  }
  if (!hasWorkspaceColumn("primary_session_id")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN primary_session_id TEXT");
  }
  const memoryColumns = db
    .prepare("PRAGMA table_info(memories)")
    .all() as { name: string }[];
  if (!memoryColumns.some((column) => column.name === "revision")) {
    db.exec("ALTER TABLE memories ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasWorkspaceColumn("revision")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
  }
  db.exec(`
    UPDATE workspaces
    SET primary_session_id = (
      SELECT sb.opencode_session_id
      FROM session_bindings sb
      WHERE sb.workspace_id = workspaces.id
      ORDER BY sb.updated_at DESC, sb.opencode_session_id DESC
      LIMIT 1
    )
    WHERE primary_session_id IS NULL;
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
  if (!hasGoalLoopColumn("pause_requested")) {
    db.exec("ALTER TABLE goal_loops ADD COLUMN pause_requested INTEGER NOT NULL DEFAULT 0");
  }
  // 完走モード: 完了宣言・検証を使わず max_turns まで必ず goal ターンを回す（既定 OFF）
  if (!hasGoalLoopColumn("force_full_run")) {
    db.exec("ALTER TABLE goal_loops ADD COLUMN force_full_run INTEGER NOT NULL DEFAULT 0");
  }
  const sessionBindingColumns = db
    .prepare("PRAGMA table_info(session_bindings)")
    .all() as { name: string }[];
  if (!sessionBindingColumns.some((column) => column.name === "favorite")) {
    db.exec("ALTER TABLE session_bindings ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
  }
  const workflowAttemptColumns = db
    .prepare("PRAGMA table_info(workflow_node_attempts)")
    .all() as { name: string }[];
  if (!workflowAttemptColumns.some((column) => column.name === "usage_snapshot")) {
    db.exec("ALTER TABLE workflow_node_attempts ADD COLUMN usage_snapshot TEXT NOT NULL DEFAULT '{}'");
  }
  const projectColumns = db
    .prepare("PRAGMA table_info(projects)")
    .all() as { name: string }[];
  if (!projectColumns.some((column) => column.name === "archived")) {
    db.exec("ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
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
       WHERE archived = 0
       ORDER BY favorite DESC, COALESCE(last_opened_at, created_at) DESC`,
    )
    .all() as ProjectRow[];
}

export function listArchivedProjects(): ProjectRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM projects
       WHERE archived = 1
       ORDER BY COALESCE(last_opened_at, created_at) DESC`,
    )
    .all() as ProjectRow[];
}

export function setProjectArchived(id: string, archived: boolean): void {
  getDb()
    .prepare(`UPDATE projects SET archived = ? WHERE id = ?`)
    .run(archived ? 1 : 0, id);
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
  const database = getDb();
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO session_bindings (workspace_id, opencode_session_id, title, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(workspace_id, opencode_session_id) DO UPDATE SET
           title = excluded.title,
           updated_at = excluded.updated_at`,
      )
      .run(workspaceId, opencodeSessionId, title, updatedAt ?? new Date().toISOString());
    database
      .prepare(
        `UPDATE workspaces
         SET primary_session_id = ?, revision = revision + 1
         WHERE id = ? AND primary_session_id IS NULL`,
      )
      .run(opencodeSessionId, workspaceId);
  })();
}

/** Update the favorite state without changing session recency. */
export function setSessionFavorite(
  workspaceId: string,
  opencodeSessionId: string,
  favorite: boolean,
): boolean {
  if (!isSafeOpenCodeSessionId(opencodeSessionId)) return false;
  const info = getDb()
    .prepare(
      `UPDATE session_bindings SET favorite = ?
       WHERE workspace_id = ? AND opencode_session_id = ?`,
    )
    .run(favorite ? 1 : 0, workspaceId, opencodeSessionId);
  return info.changes > 0;
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

export type MemoryIdleExtractRow = {
  workspaceId: string;
  sessionId: string;
  extractedAt: number;
};

/** Record that (workspace, session) has already been idle-extracted. */
export function markIdleExtracted(
  workspaceId: string,
  sessionId: string,
  extractedAt = Date.now(),
): void {
  getDb()
    .prepare(
      `INSERT INTO memory_idle_extracts (workspace_id, session_id, extracted_at)
       VALUES (?, ?, ?)
       ON CONFLICT(workspace_id, session_id) DO UPDATE SET extracted_at = excluded.extracted_at`,
    )
    .run(workspaceId, sessionId, extractedAt);
}

/** True when (workspace, session) has already been idle-extracted. */
export function isIdleExtracted(workspaceId: string, sessionId: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM memory_idle_extracts
       WHERE workspace_id = ? AND session_id = ?`,
    )
    .get(workspaceId, sessionId);
  return row !== undefined;
}

/** Every idle-extracted (workspace, session) pair, oldest first. */
export function listIdleExtracts(): MemoryIdleExtractRow[] {
  const rows = getDb()
    .prepare(
      `SELECT workspace_id, session_id, extracted_at FROM memory_idle_extracts
       ORDER BY extracted_at ASC`,
    )
    .all() as { workspace_id: string; session_id: string; extracted_at: number }[];
  return rows.map((r) => ({
    workspaceId: r.workspace_id,
    sessionId: r.session_id,
    extractedAt: r.extracted_at,
  }));
}

export const MEMORY_EXTRACTION_TRIGGERS = [
  "assistant-completed",
  "goal-completed",
  "idle",
  "manual",
] as const;
export type MemoryExtractionTrigger = (typeof MEMORY_EXTRACTION_TRIGGERS)[number];
export type MemoryExtractionRunStatus = "running" | "completed" | "failed";

export type MemoryExtractionRunDto = {
  id: string;
  workspaceId: string;
  sourceSessionId: string;
  assistantMessageId: string | null;
  trigger: MemoryExtractionTrigger;
  status: MemoryExtractionRunStatus;
  createdCount: number;
  savedCount: number;
  candidateCount: number;
  rejectedCount: number;
  skippedCount: number;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
  readAt: number | null;
};

function toMemoryExtractionRunDto(row: {
  id: string;
  workspace_id: string;
  source_session_id: string;
  assistant_message_id: string | null;
  trigger_type: MemoryExtractionTrigger;
  status: MemoryExtractionRunStatus;
  created_count: number;
  saved_count: number;
  candidate_count: number;
  rejected_count: number;
  skipped_count: number;
  error: string | null;
  started_at: number;
  completed_at: number | null;
  read_at: number | null;
}): MemoryExtractionRunDto {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceSessionId: row.source_session_id,
    assistantMessageId: row.assistant_message_id,
    trigger: row.trigger_type,
    status: row.status,
    createdCount: row.created_count,
    savedCount: row.saved_count,
    candidateCount: row.candidate_count,
    rejectedCount: row.rejected_count,
    skippedCount: row.skipped_count,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    readAt: row.read_at,
  };
}

export function createMemoryExtractionRun(input: {
  workspaceId: string;
  sourceSessionId: string;
  assistantMessageId?: string;
  trigger: MemoryExtractionTrigger;
  startedAt?: number;
}): string {
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO memory_extraction_runs
        (id, workspace_id, source_session_id, assistant_message_id, trigger_type, status,
         created_count, saved_count, candidate_count, rejected_count, skipped_count,
         error, started_at, completed_at, read_at)
       VALUES (?, ?, ?, ?, ?, 'running', 0, 0, 0, 0, 0, NULL, ?, NULL, NULL)`,
    )
    .run(
      id,
      input.workspaceId,
      input.sourceSessionId,
      input.assistantMessageId ?? null,
      input.trigger,
      input.startedAt ?? Date.now(),
    );
  return id;
}

export function completeMemoryExtractionRun(
  id: string,
  counts: {
    created: number;
    saved: number;
    candidates: number;
    rejected: number;
    skipped: number;
  },
  completedAt = Date.now(),
): boolean {
  return (
    getDb()
      .prepare(
        `UPDATE memory_extraction_runs
         SET status = 'completed', created_count = ?, saved_count = ?, candidate_count = ?,
             rejected_count = ?, skipped_count = ?, error = NULL, completed_at = ?
         WHERE id = ?`,
      )
      .run(
        Math.max(0, counts.created),
        Math.max(0, counts.saved),
        Math.max(0, counts.candidates),
        Math.max(0, counts.rejected),
        Math.max(0, counts.skipped),
        completedAt,
        id,
      ).changes > 0
  );
}

export function failMemoryExtractionRun(
  id: string,
  error: string,
  completedAt = Date.now(),
): boolean {
  return (
    getDb()
      .prepare(
        `UPDATE memory_extraction_runs
         SET status = 'failed', error = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(Array.from(error).slice(0, 4000).join(""), completedAt, id).changes > 0
  );
}

export function listMemoryExtractionRuns(input?: {
  workspaceId?: string;
  limit?: number;
  unreadOnly?: boolean;
}): MemoryExtractionRunDto[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input?.workspaceId) {
    clauses.push("workspace_id = ?");
    params.push(input.workspaceId);
  }
  if (input?.unreadOnly) clauses.push("read_at IS NULL");
  const limit = Math.max(1, Math.min(100, Math.floor(input?.limit ?? 30)));
  params.push(limit);
  const rows = getDb()
    .prepare(
      `SELECT * FROM memory_extraction_runs
       ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY started_at DESC, id DESC LIMIT ?`,
    )
    .all(...params) as Parameters<typeof toMemoryExtractionRunDto>[0][];
  return rows.map(toMemoryExtractionRunDto);
}

export function countUnreadMemoryExtractionRuns(workspaceId?: string): number {
  const row = workspaceId
    ? (getDb()
        .prepare(
          "SELECT COUNT(*) AS count FROM memory_extraction_runs WHERE workspace_id = ? AND read_at IS NULL",
        )
        .get(workspaceId) as { count: number })
    : (getDb()
        .prepare("SELECT COUNT(*) AS count FROM memory_extraction_runs WHERE read_at IS NULL")
        .get() as { count: number });
  return row.count;
}

export function markMemoryExtractionRunsRead(
  workspaceId?: string,
  readAt = Date.now(),
): number {
  const result = workspaceId
    ? getDb()
        .prepare(
          "UPDATE memory_extraction_runs SET read_at = COALESCE(read_at, ?) WHERE workspace_id = ? AND read_at IS NULL",
        )
        .run(readAt, workspaceId)
    : getDb()
        .prepare(
          "UPDATE memory_extraction_runs SET read_at = COALESCE(read_at, ?) WHERE read_at IS NULL",
        )
        .run(readAt);
  return result.changes;
}

export const MEMORY_ASSISTANT_EXTRACT_CLAIM_TTL_MS = 10 * 60 * 1000;

export type MemoryAssistantExtractClaim = {
  workspaceId: string;
  sessionId: string;
  assistantMessageId: string;
  claimedAt: number;
};

/**
 * Atomically claim one completed assistant message for background extraction.
 * Completed rows are permanent; stale in-flight rows can be reclaimed after
 * the TTL so a killed WebUI process does not disable future learning.
 */
export function claimAssistantMemoryExtraction(
  workspaceId: string,
  sessionId: string,
  assistantMessageId: string,
  now = Date.now(),
): MemoryAssistantExtractClaim | null {
  const db = getDb();
  return db.transaction(() => {
    const existing = db
      .prepare(
        `SELECT status, claimed_at FROM memory_assistant_extracts
         WHERE workspace_id = ? AND session_id = ? AND assistant_message_id = ?`,
      )
      .get(workspaceId, sessionId, assistantMessageId) as
      | { status: "in_flight" | "completed"; claimed_at: number }
      | undefined;
    if (existing?.status === "completed") return null;
    if (
      existing &&
      existing.status === "in_flight" &&
      now - existing.claimed_at < MEMORY_ASSISTANT_EXTRACT_CLAIM_TTL_MS
    ) {
      return null;
    }
    db.prepare(
      `INSERT INTO memory_assistant_extracts
        (workspace_id, session_id, assistant_message_id, status, claimed_at, extracted_at)
       VALUES (?, ?, ?, 'in_flight', ?, NULL)
       ON CONFLICT(workspace_id, session_id, assistant_message_id) DO UPDATE SET
         status = 'in_flight', claimed_at = excluded.claimed_at, extracted_at = NULL`,
    ).run(workspaceId, sessionId, assistantMessageId, now);
    return { workspaceId, sessionId, assistantMessageId, claimedAt: now };
  })();
}

/** Mark a claimed assistant message as successfully extracted. */
export function completeAssistantMemoryExtraction(
  claim: MemoryAssistantExtractClaim,
  extractedAt = Date.now(),
): boolean {
  return (
    getDb()
      .prepare(
        `UPDATE memory_assistant_extracts
         SET status = 'completed', extracted_at = ?
         WHERE workspace_id = ? AND session_id = ? AND assistant_message_id = ?
           AND status = 'in_flight' AND claimed_at = ?`,
      )
      .run(
        extractedAt,
        claim.workspaceId,
        claim.sessionId,
        claim.assistantMessageId,
        claim.claimedAt,
      ).changes > 0
  );
}

/** Release a failed claim so a later event/retry can attempt extraction again. */
export function releaseAssistantMemoryExtraction(
  claim: MemoryAssistantExtractClaim,
): boolean {
  return (
    getDb()
      .prepare(
        `DELETE FROM memory_assistant_extracts
         WHERE workspace_id = ? AND session_id = ? AND assistant_message_id = ?
           AND status = 'in_flight' AND claimed_at = ?`,
      )
      .run(
        claim.workspaceId,
        claim.sessionId,
        claim.assistantMessageId,
        claim.claimedAt,
      ).changes > 0
  );
}

/** Goal-loop turns have their own completion hook and must not be extracted twice. */
export function hasActiveGoalLoopForSession(
  workspaceId: string,
  sessionId: string,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM goal_loops
       WHERE workspace_id = ? AND opencode_session_id = ?
         AND status IN ('queued', 'running', 'verifying_completed')
       LIMIT 1`,
    )
    .get(workspaceId, sessionId);
  return row !== undefined;
}

/** All session bindings for a workspace (newest first). */
export function listSessionBindings(workspaceId: string): SessionBindingRow[] {
  return getDb()
    .prepare(
       `SELECT * FROM session_bindings WHERE workspace_id = ?
       ORDER BY favorite DESC, updated_at DESC`,
    )
    .all(workspaceId) as SessionBindingRow[];
}

/**
 * Workspaces bound to an OpenCode session id, newest activity first.
 *
 * `session_bindings` is keyed on `(workspace_id, opencode_session_id)`, so one
 * session can legitimately be bound to more than one workspace. Used by the
 * OpenCode proxy to find the goal loops that a manual send must pause.
 */
export function findWorkspaceIdsBySession(opencodeSessionId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT workspace_id FROM session_bindings WHERE opencode_session_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(opencodeSessionId) as { workspace_id: string }[];
  return rows.map((row) => row.workspace_id);
}

/** Resolve a session only within the validated directory of the request. */
export function findWorkspaceIdsBySessionAndDirectory(
  opencodeSessionId: string,
  directory: string,
): string[] {
  const rows = getDb()
    .prepare(
      `SELECT w.id, w.absolute_path
       FROM workspaces w
       JOIN session_bindings sb ON sb.workspace_id = w.id
       WHERE sb.opencode_session_id = ?`,
    )
    .all(opencodeSessionId) as { id: string; absolute_path: string }[];
  const normalizedDirectory = normalizeComparablePath(directory);
  return rows
    .filter((row) => normalizeComparablePath(row.absolute_path) === normalizedDirectory)
    .map((row) => row.id);
}

function normalizeComparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
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
    .prepare(
      `SELECT * FROM session_bindings
       ORDER BY updated_at ASC, opencode_session_id ASC`,
    )
    .all() as SessionBindingRow[];
  const map = new Map<string, SessionBindingRow>();
  for (const row of rows) map.set(row.workspace_id, row);
  return map;
}

/** The explicitly selected primary binding for each workspace. */
export function primaryBindings(): Map<string, SessionBindingRow> {
  const rows = getDb()
    .prepare(
      `SELECT sb.*
       FROM workspaces w
       JOIN session_bindings sb
         ON sb.workspace_id = w.id
        AND sb.opencode_session_id = w.primary_session_id
       ORDER BY w.id ASC`,
    )
    .all() as SessionBindingRow[];
  return new Map(rows.map((row) => [row.workspace_id, row]));
}

/**
 * Change the primary session using a workspace revision CAS. The target must
 * already be bound to the workspace, so a reviewer cannot become primary by
 * merely touching its session binding.
 */
export function setPrimarySession(
  workspaceId: string,
  opencodeSessionId: string,
  expectedRevision: number,
): boolean {
  if (!isSafeOpenCodeSessionId(opencodeSessionId)) return false;
  const info = getDb()
    .prepare(
      `UPDATE workspaces
       SET primary_session_id = ?, revision = revision + 1
       WHERE id = ? AND revision = ?
         AND EXISTS (
           SELECT 1 FROM session_bindings sb
           WHERE sb.workspace_id = workspaces.id
             AND sb.opencode_session_id = ?
         )`,
    )
    .run(opencodeSessionId, workspaceId, expectedRevision, opencodeSessionId);
  return info.changes > 0;
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
  // memories has no FK on older installed databases, so clean it explicitly
  // along with its audit trail before deleting the workspace row.
  getDb().prepare("DELETE FROM memories WHERE workspace_id = ?").run(id);
  getDb().prepare("DELETE FROM memory_audit_log WHERE workspace_id = ?").run(id);
  getDb().prepare("DELETE FROM memory_idle_extracts WHERE workspace_id = ?").run(id);
  getDb().prepare("DELETE FROM memory_assistant_extracts WHERE workspace_id = ?").run(id);
  getDb().prepare("DELETE FROM memory_extraction_runs WHERE workspace_id = ?").run(id);
  getDb().prepare("DELETE FROM memory_session_injections WHERE workspace_id = ?").run(id);
  getDb().prepare("DELETE FROM collaboration_snapshots WHERE workspace_id = ?").run(id);
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
  // Project deletion cascades workspaces directly and therefore does not pass
  // through deleteWorkspace. Clean memory tables explicitly to avoid orphaned
  // content when this low-level helper is used by restore/maintenance code.
  getDb()
    .prepare(
      "DELETE FROM memories WHERE workspace_id IN (SELECT id FROM workspaces WHERE project_id = ?)",
    )
    .run(id);
  getDb()
    .prepare(
      "DELETE FROM memory_audit_log WHERE workspace_id IN (SELECT id FROM workspaces WHERE project_id = ?)",
    )
    .run(id);
  getDb()
    .prepare(
      "DELETE FROM memory_idle_extracts WHERE workspace_id IN (SELECT id FROM workspaces WHERE project_id = ?)",
    )
    .run(id);
  getDb()
    .prepare(
      "DELETE FROM memory_assistant_extracts WHERE workspace_id IN (SELECT id FROM workspaces WHERE project_id = ?)",
    )
    .run(id);
  getDb()
    .prepare(
      "DELETE FROM memory_extraction_runs WHERE workspace_id IN (SELECT id FROM workspaces WHERE project_id = ?)",
    )
    .run(id);
  getDb()
    .prepare(
      "DELETE FROM memory_session_injections WHERE workspace_id IN (SELECT id FROM workspaces WHERE project_id = ?)",
    )
    .run(id);
  getDb()
    .prepare(
      "DELETE FROM collaboration_snapshots WHERE workspace_id IN (SELECT id FROM workspaces WHERE project_id = ?)",
    )
    .run(id);
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
  return row;
}

export function removeAllowedRoot(rootPath: string): void {
  getDb().prepare("DELETE FROM allowed_roots WHERE path = ?").run(rootPath);
}

export type CollaborationSnapshotRow = {
  workspaceId: string;
  sessionId: string;
  fingerprint: string;
  snapshot: string;
  injectedAt: number;
  compactedAt: number | null;
};

export function getCollaborationSnapshot(
  workspaceId: string,
  sessionId: string,
): CollaborationSnapshotRow | null {
  const row = getDb()
    .prepare(
      `SELECT workspace_id, session_id, fingerprint, snapshot, injected_at, compacted_at
       FROM collaboration_snapshots WHERE workspace_id = ? AND session_id = ?`,
    )
    .get(workspaceId, sessionId) as
    | {
        workspace_id: string;
        session_id: string;
        fingerprint: string;
        snapshot: string;
        injected_at: number;
        compacted_at: number | null;
      }
    | undefined;
  if (!row) return null;
  return {
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    fingerprint: row.fingerprint,
    snapshot: row.snapshot,
    injectedAt: row.injected_at,
    compactedAt: row.compacted_at,
  };
}

export function upsertCollaborationSnapshot(
  workspaceId: string,
  sessionId: string,
  fingerprint: string,
  snapshot: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO collaboration_snapshots (workspace_id, session_id, fingerprint, snapshot, injected_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, session_id) DO UPDATE SET
         fingerprint = excluded.fingerprint,
         snapshot = excluded.snapshot,
         injected_at = excluded.injected_at,
         compacted_at = NULL`,
    )
    .run(workspaceId, sessionId, fingerprint, snapshot, Date.now());
}

export function markCollaborationSnapshotCompacted(
  workspaceId: string,
  sessionId: string,
): void {
  getDb()
    .prepare(
      `UPDATE collaboration_snapshots SET compacted_at = ? WHERE workspace_id = ? AND session_id = ?`,
    )
    .run(Date.now(), workspaceId, sessionId);
}

export function clearCollaborationSnapshotCompacted(
  workspaceId: string,
  sessionId: string,
): void {
  getDb()
    .prepare(
      `UPDATE collaboration_snapshots SET compacted_at = NULL WHERE workspace_id = ? AND session_id = ?`,
    )
    .run(workspaceId, sessionId);
}

export const SESSION_COMPACTION_LOCK_TTL_MS = 60_000;

/**
 * Acquire the one compaction lock for a session. The expired-row cleanup and
 * INSERT happen in one transaction, so concurrent tabs cannot both acquire
 * the same session lock.
 */
export function tryAcquireSessionCompactionLock(
  sessionId: string,
  ownerId: string,
  now = Date.now(),
  ttlMs = SESSION_COMPACTION_LOCK_TTL_MS,
): boolean {
  const expiresAt = now + Math.max(1, Math.round(ttlMs));
  return getDb().transaction(() => {
    getDb()
      .prepare("DELETE FROM session_compaction_locks WHERE expires_at <= ?")
      .run(now);
    const result = getDb()
      .prepare(
        `INSERT OR IGNORE INTO session_compaction_locks
          (session_id, owner_id, acquired_at, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(sessionId, ownerId, now, expiresAt);
    return result.changes === 1;
  })();
}

/** Release only the lock owned by this request. */
export function releaseSessionCompactionLock(
  sessionId: string,
  ownerId: string,
): boolean {
  const result = getDb()
    .prepare(
      "DELETE FROM session_compaction_locks WHERE session_id = ? AND owner_id = ?",
    )
    .run(sessionId, ownerId);
  return result.changes === 1;
}
