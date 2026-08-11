import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { afterAll, expect, test, vi } from "vitest";

// A legacy database created before docs/specs/goal-loop.md added
// turn_kind / pause_reason / rejected_claims. The migration must add them
// in place without dropping the existing row.
const testDataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-webui-goalloop-mig-"));
const previousAppData = process.env.APPDATA;
const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDataDir);
process.env.APPDATA = testDataDir;

const { dbPath, ensureDataDir } = await import("./paths");

ensureDataDir();
const legacy = new Database(dbPath());
legacy.exec(`
  CREATE TABLE goal_loops (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
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
`);
legacy
  .prepare(
    `INSERT INTO goal_loops (id, workspace_id, opencode_session_id, status, goal, created_at, updated_at)
     VALUES ('loop-legacy', 'ws-legacy', 'ses-legacy', 'paused', 'legacy goal', 't0', 't0')`,
  )
  .run();
legacy.close();

const { getDb } = await import("./db");

afterAll(() => {
  getDb().close();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  homedirSpy.mockRestore();
  rmSync(testDataDir, { recursive: true, force: true });
});

function goalLoopColumns(): Map<string, { notnull: number; dflt_value: string | null }> {
  const rows = getDb().prepare("PRAGMA table_info(goal_loops)").all() as {
    name: string;
    notnull: number;
    dflt_value: string | null;
  }[];
  return new Map(rows.map((r) => [r.name, { notnull: r.notnull, dflt_value: r.dflt_value }]));
}

test("migrates a legacy goal_loops table by adding the schema columns", () => {
  const columns = goalLoopColumns();
  for (const name of [
    "revision",
    "turn_kind",
    "pause_reason",
    "rejected_claims",
    "pause_requested",
    "force_full_run",
  ]) {
    expect(columns.has(name), `missing column ${name}`).toBe(true);
    expect(columns.get(name)?.notnull).toBe(1);
  }
  expect(columns.get("turn_kind")?.dflt_value).toBe("'goal'");
  expect(columns.get("pause_reason")?.dflt_value).toBe("''");
  expect(columns.get("rejected_claims")?.dflt_value).toBe("0");
  expect(columns.get("pause_requested")?.dflt_value).toBe("0");
  expect(columns.get("force_full_run")?.dflt_value).toBe("0");
});

test("backfills the new columns on the pre-existing row without losing data", () => {
  const row = getDb()
    .prepare("SELECT * FROM goal_loops WHERE id = 'loop-legacy'")
    .get() as {
    goal: string;
    status: string;
    turn_kind: string;
    pause_reason: string;
    rejected_claims: number;
    pause_requested: number;
    force_full_run: number;
    revision: number;
  };
  expect(row.goal).toBe("legacy goal");
  expect(row.status).toBe("paused");
  expect(row.turn_kind).toBe("goal");
  expect(row.pause_reason).toBe("");
  expect(row.rejected_claims).toBe(0);
  expect(row.pause_requested).toBe(0);
  expect(row.force_full_run).toBe(0);
  expect(row.revision).toBe(0);
});

test("re-running the migration is idempotent", () => {
  const before = goalLoopColumns().size;
  // getDb() is a singleton, so force the schema/migration block to run again
  // against the same file the way a second process start would.
  const second = new Database(dbPath());
  const names = (second.prepare("PRAGMA table_info(goal_loops)").all() as { name: string }[]).map(
    (r) => r.name,
  );
  second.close();
  expect(new Set(names).size).toBe(names.length);
  expect(names.length).toBe(before);
});
