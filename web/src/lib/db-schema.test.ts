import path from "node:path";
import os from "node:os";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { afterAll, test, expect, vi } from "vitest";

/**
 * Schema-consistency guard (REFACTORING_PLAN P2-b / IMPROVEMENT 3-2).
 *
 * A fresh database and a database upgraded from a legacy schema must end up
 * with the SAME shape (`PRAGMA table_info` per table). This is the safety net
 * for replacing the ad-hoc ALTER TABLE chain with `PRAGMA user_version`
 * migrations: the refactor must keep this test green with the same assertions.
 */

/** Legacy shape: the tables that historically received ALTER TABLE columns,
 *  minus every column that getDb() adds via ALTER TABLE. */
const LEGACY_SQL = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  favorite INTEGER NOT NULL DEFAULT 0,
  last_opened_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE workspaces (
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
CREATE TABLE session_bindings (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  opencode_session_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, opencode_session_id)
);
CREATE TABLE goal_loops (
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE workflow_node_attempts (
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
  revision INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE (node_run_id, attempt_no)
);
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  source_session_id TEXT,
  provenance TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0
);
`;

const testDataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-webui-schema-"));
const previousAppData = process.env.APPDATA;
const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDataDir);
process.env.APPDATA = testDataDir;

type TableInfo = Record<string, string[]>;

/** Remove the whole data dir so every test starts from a clean slate. */
function resetDataDir(): void {
  rmSync(path.join(testDataDir, "leafcode"), { recursive: true, force: true });
}

/** Column names per table (sqlite_master, excluding internal tables). */
function tableInfo(db: Database.Database): TableInfo {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  const info: TableInfo = {};
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[];
    info[name] = cols.map((c) => c.name).sort();
  }
  return info;
}

async function openFreshDb(): Promise<TableInfo> {
  resetDataDir();
  vi.resetModules();
  const { getDb } = await import("./db");
  const db = getDb();
  const info = tableInfo(db);
  db.close();
  return info;
}

async function openUpgradedLegacyDb(): Promise<TableInfo> {
  resetDataDir();
  const dataDir = path.join(testDataDir, "leafcode");
  mkdirSync(dataDir, { recursive: true });
  const legacy = new Database(path.join(dataDir, "webui.db"));
  legacy.exec(LEGACY_SQL);
  legacy.close();
  vi.resetModules();
  const { getDb } = await import("./db");
  const db = getDb();
  const info = tableInfo(db);
  db.close();
  return info;
}

afterAll(() => {
  homedirSpy.mockRestore();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  rmSync(testDataDir, { recursive: true, force: true });
});

test("fresh database contains every expected table", async () => {
  const fresh = await openFreshDb();
  const names = Object.keys(fresh);
  for (const expected of [
    "settings",
    "allowed_roots",
    "projects",
    "workspaces",
    "session_bindings",
    "goal_loops",
    "workflow_runs",
    "workflow_node_runs",
    "workflow_node_attempts",
    "workflow_artifacts",
    "workflow_graphs",
    "workflow_graph_nodes",
    "workflow_graph_edges",
    "session_hang_watches",
    "memories",
    "memory_audit_log",
    "memory_extraction_runs",
    "memory_idle_extracts",
    "memory_assistant_extracts",
    "memory_session_extract_state",
    "memory_session_injections",
    "collaboration_snapshots",
    "session_compaction_locks",
  ]) {
    expect(names).toContain(expected);
  }
});

test("legacy database upgraded by getDb() has the same shape as a fresh one", async () => {
  const fresh = await openFreshDb();
  const upgraded = await openUpgradedLegacyDb();
  expect(upgraded).toEqual(fresh);
});

test("getDb() keeps a pre-upgrade backup of an existing database", async () => {
  resetDataDir();
  const dataDir = path.join(testDataDir, "leafcode");
  mkdirSync(dataDir, { recursive: true });
  const legacy = new Database(path.join(dataDir, "webui.db"));
  legacy.exec(
    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);" +
      "INSERT INTO settings VALUES ('k', 'v');",
  );
  legacy.close();
  vi.resetModules();
  const { getDb } = await import("./db");
  getDb().close();
  const bak = new Database(path.join(dataDir, "webui.db.bak"));
  const row = bak.prepare("SELECT value FROM settings WHERE key = 'k'").get();
  bak.close();
  expect(row).toEqual({ value: "v" });
});

test("getDb() stamps user_version and skips the migration chain on the next open", async () => {
  resetDataDir();
  vi.resetModules();
  const { getDb } = await import("./db");
  const db = getDb();
  const version = db.pragma("user_version", { simple: true }) as number;
  db.close();
  // Legacy databases (user_version 0) are upgraded; fresh ones are stamped.
  expect(version).toBeGreaterThanOrEqual(1);
  // Reopening is idempotent: same handle is reused while open, and a fresh
  // open of a stamped database does not re-run migrations (shape unchanged).
  vi.resetModules();
  const { getDb: getDbAgain } = await import("./db");
  const reopened = getDbAgain();
  expect(reopened.pragma("user_version", { simple: true })).toBe(version);
  reopened.close();
});

test("a fully shaped database at version 0 is upgraded without errors", async () => {
  resetDataDir();
  const dataDir = path.join(testDataDir, "leafcode");
  mkdirSync(dataDir, { recursive: true });
  const { SCHEMA_SQL } = await import("./db-schema");
  const full = new Database(path.join(dataDir, "webui.db"));
  full.exec(SCHEMA_SQL);
  full.pragma("user_version = 0");
  full.close();
  vi.resetModules();
  const { getDb } = await import("./db");
  const db = getDb();
  expect(db.pragma("user_version", { simple: true })).toBe(1);
  db.close();
});
