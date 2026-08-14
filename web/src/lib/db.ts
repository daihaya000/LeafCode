import Database from "better-sqlite3";
import { copyFileSync, existsSync } from "node:fs";
import { CURRENT_SCHEMA_VERSION, MIGRATIONS, SCHEMA_SQL } from "./db-schema";
import { isSafeOpenCodeSessionId } from "./opencode-id";
import { normalizeMemoryKey } from "./memory-key";
import { dbPath, ensureDataDir } from "./paths";
import type { TaskExecutionMode } from "./types";
import path from "node:path";

let db: Database.Database | null = null;

/**
 * Pre-upgrade backup (REFACTORING_PLAN P2-c / IMPROVEMENT 3-2, decision D4):
 * keep a copy of the database file from before this run's migrations, so a
 * schema-migration failure can be recovered by restoring `webui.db.bak`.
 * A failed copy never blocks startup: the schema-consistency tests are the
 * primary safety net.
 */
function backupDbFile(dbFile: string): void {
  try {
    if (existsSync(dbFile)) {
      copyFileSync(dbFile, `${dbFile}.bak`);
    }
  } catch {
    // Non-fatal: backup is best-effort recovery support.
  }
}


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
  // A closed handle is never usable again, so drop it and reconnect instead of
  // handing back a dead connection (this also re-runs schema init, which is
  // idempotent and is what an upgrade path exercises).
  if (db?.open) return db;
  db = null;
  ensureDataDir();
  backupDbFile(dbPath());
  db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  // Enforce foreign keys so ON DELETE CASCADE (workspaces/goal_loops/session_bindings
  // → projects/workspaces) actually fires. better-sqlite3 defaults this off.
  db.pragma("foreign_keys = ON");
  // SCHEMA_SQL is idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF
  // NOT EXISTS / DROP TRIGGER + CREATE TRIGGER), so it runs on every open and
  // creates the full schema for fresh databases. A fresh database (no tables)
  // is stamped with CURRENT_SCHEMA_VERSION directly. Legacy databases run the
  // ordered MIGRATIONS list and are stamped version by version
  // (REFACTORING_PLAN P2-e).
  const tableCount = db
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .get() as { n: number };
  const isFreshDb = tableCount.n === 0;
  db.exec(SCHEMA_SQL);
  const schemaVersion = db.pragma("user_version", { simple: true }) as number;
  if (isFreshDb) {
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
  } else if (schemaVersion < CURRENT_SCHEMA_VERSION) {
    runSchemaMigrations(db);
  }
  return db;
}

/**
 * Apply the ordered migrations for a database stamped below the current
 * version. Each migration adds its columns only when missing (a database at
 * version 0 may already be fully shaped, e.g. it was opened by a build that
 * ran SCHEMA_SQL without stamping) and then runs its additive SQL. The
 * JS-driven norm-key backfill runs after the SQL steps.
 */
function runSchemaMigrations(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      for (const step of migration.columns) {
        const cols = db
          .prepare(`PRAGMA table_info(${step.table})`)
          .all() as { name: string }[];
        if (cols.some((c) => c.name === step.column)) continue;
        db.exec(step.sql);
      }
      if (migration.sql) db.exec(migration.sql);
      // Stamp inside the same transaction so an interrupted migration never
      // leaves the SQL applied without the version marker (or vice versa).
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
  backfillMemoryNormKeys(db);
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

/**
 * Fill `memories.norm_key` for rows written before the dedupe key existed.
 * NFKC normalization is not expressible in SQL, so this runs in JS once per
 * process startup; after the first pass the guarded SELECT matches no rows.
 */
function backfillMemoryNormKeys(database: Database.Database): void {
  const rows = database
    .prepare("SELECT id, content FROM memories WHERE norm_key IS NULL LIMIT 20000")
    .all() as { id: string; content: string }[];
  if (rows.length === 0) return;
  const update = database.prepare("UPDATE memories SET norm_key = ? WHERE id = ?");
  database.transaction(() => {
    for (const row of rows) update.run(normalizeMemoryKey(row.content), row.id);
  })();
}

export type MemorySessionExtractState = {
  workspaceId: string;
  sessionId: string;
  lastMessageId: string | null;
  lastExtractedAt: number;
};

/** Incremental-extraction state for one (workspace, session), if any. */
export function getSessionExtractState(
  workspaceId: string,
  sessionId: string,
): MemorySessionExtractState | undefined {
  const row = getDb()
    .prepare(
      `SELECT workspace_id, session_id, last_message_id, last_extracted_at
       FROM memory_session_extract_state
       WHERE workspace_id = ? AND session_id = ?`,
    )
    .get(workspaceId, sessionId) as
    | {
        workspace_id: string;
        session_id: string;
        last_message_id: string | null;
        last_extracted_at: number;
      }
    | undefined;
  if (!row) return undefined;
  return {
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    lastMessageId: row.last_message_id,
    lastExtractedAt: row.last_extracted_at,
  };
}

/**
 * Record how far a session's transcript has been digested. Called only after a
 * run finishes without error, so a failed run re-reads the same delta.
 */
export function setSessionExtractState(input: {
  workspaceId: string;
  sessionId: string;
  lastMessageId: string | null;
  extractedAt?: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO memory_session_extract_state
        (workspace_id, session_id, last_message_id, last_extracted_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, session_id) DO UPDATE SET
         last_message_id = excluded.last_message_id,
         last_extracted_at = excluded.last_extracted_at`,
    )
    .run(
      input.workspaceId,
      input.sessionId,
      input.lastMessageId,
      input.extractedAt ?? Date.now(),
    );
}

/**
 * Minimum spacing between automatic extractions of one session. The v1 layer
 * extracted on every completed assistant message, which produced 1,570 runs
 * (and thousands of paraphrased rows) in normal use.
 */
export const MEMORY_EXTRACT_COOLDOWN_MS = 10 * 60 * 1000;

/** True when this session was auto-extracted too recently to run again. */
export function isSessionExtractCooldownActive(
  workspaceId: string,
  sessionId: string,
  now = Date.now(),
  cooldownMs: number = MEMORY_EXTRACT_COOLDOWN_MS,
): boolean {
  const state = getSessionExtractState(workspaceId, sessionId);
  if (!state || state.lastExtractedAt <= 0) return false;
  return now - state.lastExtractedAt < cooldownMs;
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
  //
  // Project-scoped rows deliberately SURVIVE workspace deletion: a workspace is
  // one task, and deleting a finished task must not erase what the project
  // learned from it. Only rows whose retrieval scope is the workspace itself
  // (legacy rows whose workspace had no project) are removed here; the whole
  // set is cleaned by deleteProject.
  getDb()
    .prepare(
      `DELETE FROM memories
       WHERE workspace_id = ? AND (scope_kind IS NULL OR scope_kind = 'workspace')`,
    )
    .run(id);
  getDb().prepare("DELETE FROM memory_audit_log WHERE workspace_id = ?").run(id);
  getDb().prepare("DELETE FROM memory_idle_extracts WHERE workspace_id = ?").run(id);
  getDb().prepare("DELETE FROM memory_assistant_extracts WHERE workspace_id = ?").run(id);
  getDb().prepare("DELETE FROM memory_session_extract_state WHERE workspace_id = ?").run(id);
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
      `DELETE FROM memories
       WHERE scope_key = ?
          OR workspace_id IN (SELECT id FROM workspaces WHERE project_id = ?)`,
    )
    .run(id, id);
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
      "DELETE FROM memory_session_extract_state WHERE workspace_id IN (SELECT id FROM workspaces WHERE project_id = ?)",
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
