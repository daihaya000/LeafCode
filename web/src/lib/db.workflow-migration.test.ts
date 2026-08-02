import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { afterAll, expect, test, vi } from "vitest";

const testDataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-webui-workflow-mig-"));
const previousAppData = process.env.APPDATA;
const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDataDir);
process.env.APPDATA = testDataDir;

const { dbPath, ensureDataDir } = await import("./paths");

ensureDataDir();
const legacy = new Database(dbPath());
legacy.exec(`
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
    project_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    absolute_path TEXT NOT NULL,
    isolation TEXT NOT NULL,
    base_branch TEXT,
    worktree_path TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  );
  CREATE TABLE session_bindings (
    workspace_id TEXT NOT NULL,
    opencode_session_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, opencode_session_id)
  );
`);
legacy
  .prepare("INSERT INTO projects (id, name, root_path, created_at) VALUES (?, ?, ?, ?)")
  .run("project-legacy", "Legacy", testDataDir, "2026-07-22T00:00:00.000Z");
legacy
  .prepare(
    `INSERT INTO workspaces
     (id, project_id, display_name, absolute_path, isolation, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  .run(
    "ws-legacy",
    "project-legacy",
    "Legacy Workspace",
    testDataDir,
    "current_folder",
    "active",
    "2026-07-22T00:00:00.000Z",
  );
legacy
  .prepare("INSERT INTO session_bindings (workspace_id, opencode_session_id, title, updated_at) VALUES (?, ?, ?, ?)")
  .run("ws-legacy", "ses-old", "Old", "2026-07-22T10:00:00.000Z");
legacy
  .prepare("INSERT INTO session_bindings (workspace_id, opencode_session_id, title, updated_at) VALUES (?, ?, ?, ?)")
  .run("ws-legacy", "ses-new", "New", "2026-07-22T11:00:00.000Z");
legacy.close();

const { getDb } = await import("./db");

afterAll(() => {
  getDb().close();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  homedirSpy.mockRestore();
  rmSync(testDataDir, { recursive: true, force: true });
});

function tableColumns(table: string): Set<string> {
  const rows = getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

test("migrates legacy workspace/session schema and backfills primary deterministically", () => {
  expect(tableColumns("workspaces")).toEqual(
    new Set([
      "id",
      "project_id",
      "display_name",
      "absolute_path",
      "isolation",
      "base_branch",
      "worktree_path",
      "status",
      "created_at",
      "execution_mode",
      "primary_session_id",
      "revision",
    ]),
  );
  expect(tableColumns("session_bindings")).toContain("favorite");

  const row = getDb()
    .prepare(
      "SELECT execution_mode, primary_session_id, revision FROM workspaces WHERE id = 'ws-legacy'",
    )
    .get() as {
    execution_mode: string;
    primary_session_id: string;
    revision: number;
  };
  expect(row).toEqual({
    execution_mode: "standard",
    primary_session_id: "ses-new",
    revision: 0,
  });
  expect(
    (getDb()
      .prepare("SELECT favorite FROM session_bindings WHERE workspace_id = 'ws-legacy' AND opencode_session_id = 'ses-new'")
      .get() as { favorite: number }).favorite,
  ).toBe(0);
});

test("creates workflow tables and prevents multiple active runs or attempts", () => {
  for (const table of [
    "workflow_runs",
    "workflow_node_runs",
    "workflow_node_attempts",
    "workflow_artifacts",
  ]) {
    expect(tableColumns(table).size).toBeGreaterThan(0);
  }
  expect(tableColumns("workflow_node_attempts")).toContain("usage_snapshot");

  const database = getDb();
  database
    .prepare(
      `INSERT INTO workflow_runs
       (id, workspace_id, template_key, definition_snapshot, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "run-active",
      "ws-legacy",
      "ui_implementation_review",
      "{}",
      "draft",
      "2026-07-22T12:00:00.000Z",
      "2026-07-22T12:00:00.000Z",
    );
  expect(() =>
    database
      .prepare(
        `INSERT INTO workflow_runs
         (id, workspace_id, template_key, definition_snapshot, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "run-second",
        "ws-legacy",
        "ui_implementation_review",
        "{}",
        "ready",
        "2026-07-22T12:01:00.000Z",
        "2026-07-22T12:01:00.000Z",
      ),
  ).toThrow();

  database
    .prepare(
      `INSERT INTO workflow_runs
       (id, workspace_id, template_key, definition_snapshot, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "run-terminal",
      "ws-legacy",
      "ui_implementation_review",
      "{}",
      "completed",
      "2026-07-22T12:02:00.000Z",
      "2026-07-22T12:02:00.000Z",
    );
  database
    .prepare(
      `INSERT INTO workflow_node_runs
       (id, workflow_run_id, node_key, kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "node-run-active",
      "run-active",
      "implement_ui",
      "implement",
      "2026-07-22T12:00:00.000Z",
      "2026-07-22T12:00:00.000Z",
    );
  database
    .prepare(
      `INSERT INTO workflow_node_attempts (id, node_run_id, attempt_no, status)
       VALUES (?, ?, ?, ?)`,
    )
    .run("attempt-running", "node-run-active", 1, "running");
  expect(() =>
    database
      .prepare(
        `INSERT INTO workflow_node_attempts (id, node_run_id, attempt_no, status)
         VALUES (?, ?, ?, ?)`,
      )
      .run("attempt-running-2", "node-run-active", 2, "dispatching"),
  ).toThrow();
});

test("workflow schema migration is idempotent for existing tables", () => {
  const database = new Database(dbPath());
  const workflowRunColumns = database
    .prepare("PRAGMA table_info(workflow_runs)")
    .all() as { name: string }[];
  const attemptColumns = database
    .prepare("PRAGMA table_info(workflow_node_attempts)")
    .all() as { name: string }[];
  database.close();

  expect(new Set(workflowRunColumns.map((row) => row.name)).size).toBe(workflowRunColumns.length);
  expect(new Set(attemptColumns.map((row) => row.name)).size).toBe(attemptColumns.length);
});
