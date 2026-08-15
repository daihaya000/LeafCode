import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const testDataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-webui-mem-mig-"));
const previousAppData = process.env.APPDATA;
const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDataDir);
process.env.APPDATA = testDataDir;

const {
  getDb,
  MEMORY_EXTRACT_COOLDOWN_MS,
  getSessionExtractState,
  setSessionExtractState,
  isSessionExtractCooldownActive,
  deleteWorkspace,
} = await import("./db");
const { createMemory, searchMemories, updateMemory, deleteMemory, listMemories } = await import(
  "./memory"
);

afterAll(() => {
  getDb().close();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  homedirSpy.mockRestore();
  rmSync(testDataDir, { recursive: true, force: true });
});

beforeAll(() => {
  // Idempotency: boot the schema twice; the second run must not throw or lose data.
  getDb().exec("SELECT 1 FROM memories LIMIT 1");
  getDb().exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, content);
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
     END;`,
  );
});

describe("memories FTS trigger sync", () => {
  it("syncs insert/update/delete into the FTS table", () => {
    const m = createMemory({
      workspaceId: "ws-m",
      kind: "fact",
      content: "tangram puzzle color",
      provenance: "manual",
      approved: true,
    });
    expect(searchMemories({ workspaceId: "ws-m", query: "tangram", limit: 5 })).toHaveLength(1);

    updateMemory(m.id, "ws-m", 0, { content: "tangram puzzle reframed" });
    expect(searchMemories({ workspaceId: "ws-m", query: "reframed", limit: 5 })).toHaveLength(1);
    // The old token is gone after the UPDATE trigger replaced content.
    expect(searchMemories({ workspaceId: "ws-m", query: "color", limit: 5 })).toHaveLength(0);

    deleteMemory(m.id, "ws-m", 1);
    expect(searchMemories({ workspaceId: "ws-m", query: "tangram", limit: 5 })).toHaveLength(0);
  });

  it("backfills scope and norm_key for rows written before the columns existed", () => {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO projects (id, name, root_path, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run("proj-legacy", "Legacy", "/legacy", now);
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO workspaces
          (id, project_id, display_name, absolute_path, isolation, status, created_at)
         VALUES (?, ?, ?, ?, 'current_folder', 'active', ?)`,
      )
      .run("ws-legacy", "proj-legacy", "legacy task", "/legacy", now);

    // Simulate v1 rows: scope columns and norm_key still NULL.
    const legacyProject = createMemory({
      workspaceId: "ws-legacy",
      kind: "fact",
      content: "legacy row inside a project",
      provenance: "manual",
      approved: true,
    });
    const legacyOrphan = createMemory({
      workspaceId: "ws-no-project",
      kind: "fact",
      content: "legacy row with no project",
      provenance: "manual",
      approved: true,
    });
    getDb()
      .prepare(
        "UPDATE memories SET scope_kind = NULL, scope_key = NULL, norm_key = NULL WHERE id IN (?, ?)",
      )
      .run(legacyProject.id, legacyOrphan.id);

    // Re-running schema init is what an upgrade does; it must repair the rows.
    // Stamp the db back to v0 so the reopen path runs the v1 migration
    // (a v1 -> v1 reopen is a no-op by design).
    getDb().pragma("user_version = 0");
    getDb().close();
    const reopened = getDb();
    const rows = reopened
      .prepare("SELECT id, scope_kind, scope_key, norm_key FROM memories WHERE id IN (?, ?)")
      .all(legacyProject.id, legacyOrphan.id) as Array<{
      id: string;
      scope_kind: string;
      scope_key: string;
      norm_key: string;
    }>;
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(legacyProject.id)).toMatchObject({
      scope_kind: "project",
      scope_key: "proj-legacy",
    });
    // A workspace without a project keeps workspace scope, so it stays private.
    expect(byId.get(legacyOrphan.id)).toMatchObject({
      scope_kind: "workspace",
      scope_key: "ws-no-project",
    });
    expect(byId.get(legacyProject.id)?.norm_key).toBeTruthy();
    expect(byId.get(legacyOrphan.id)?.norm_key).toBeTruthy();
  });

  it("keeps project-scoped memories when a finished workspace is deleted", () => {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO projects (id, name, root_path, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run("proj-keep", "Keep", "/keep", now);
    const insertWorkspace = getDb().prepare(
      `INSERT OR IGNORE INTO workspaces
        (id, project_id, display_name, absolute_path, isolation, status, created_at)
       VALUES (?, ?, ?, ?, 'current_folder', 'active', ?)`,
    );
    insertWorkspace.run("ws-keep-a", "proj-keep", "task a", "/keep", now);
    insertWorkspace.run("ws-keep-b", "proj-keep", "task b", "/keep", now);

    const learned = createMemory({
      workspaceId: "ws-keep-a",
      kind: "lesson",
      content: "survives the task that learned it",
      provenance: "auto-extract",
      approved: true,
    });
    setSessionExtractState({
      workspaceId: "ws-keep-a",
      sessionId: "ses-keep",
      lastMessageId: "m9",
    });

    expect(deleteWorkspace("ws-keep-a")?.id).toBe("ws-keep-a");
    // The memory outlives its workspace and is still readable from a sibling task.
    expect(listMemories({ workspaceId: "ws-keep-b" }).map((m) => m.id)).toContain(learned.id);
    // Per-workspace bookkeeping is still cleaned up.
    expect(getSessionExtractState("ws-keep-a", "ses-keep")).toBeUndefined();
  });

  it("tracks the extraction cursor and enforces the cooldown", () => {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO projects (id, name, root_path, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run("proj-cool", "Cool", "/cool", now);
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO workspaces
          (id, project_id, display_name, absolute_path, isolation, status, created_at)
         VALUES (?, ?, ?, ?, 'current_folder', 'active', ?)`,
      )
      .run("ws-cool", "proj-cool", "cool task", "/cool", now);

    expect(getSessionExtractState("ws-cool", "ses-cool")).toBeUndefined();
    expect(isSessionExtractCooldownActive("ws-cool", "ses-cool")).toBe(false);

    const t0 = 1_000_000_000_000;
    setSessionExtractState({
      workspaceId: "ws-cool",
      sessionId: "ses-cool",
      lastMessageId: "m1",
      extractedAt: t0,
    });
    expect(getSessionExtractState("ws-cool", "ses-cool")).toEqual({
      workspaceId: "ws-cool",
      sessionId: "ses-cool",
      lastMessageId: "m1",
      lastExtractedAt: t0,
    });
    expect(isSessionExtractCooldownActive("ws-cool", "ses-cool", t0 + 1)).toBe(true);
    expect(
      isSessionExtractCooldownActive("ws-cool", "ses-cool", t0 + MEMORY_EXTRACT_COOLDOWN_MS - 1),
    ).toBe(true);
    expect(
      isSessionExtractCooldownActive("ws-cool", "ses-cool", t0 + MEMORY_EXTRACT_COOLDOWN_MS),
    ).toBe(false);

    // Upsert advances the cursor for the same (workspace, session) pair.
    setSessionExtractState({
      workspaceId: "ws-cool",
      sessionId: "ses-cool",
      lastMessageId: "m2",
      extractedAt: t0 + 5,
    });
    expect(getSessionExtractState("ws-cool", "ses-cool")?.lastMessageId).toBe("m2");
    expect(
      (
        getDb()
          .prepare("SELECT COUNT(*) AS n FROM memory_session_extract_state WHERE session_id = ?")
          .get("ses-cool") as { n: number }
      ).n,
    ).toBe(1);
    // Sessions are tracked independently.
    expect(isSessionExtractCooldownActive("ws-cool", "ses-other", t0 + 5)).toBe(false);
  });

  it("keeps the FTS rowcount in step with memories (no orphan/dup via triggers)", () => {
    const before = (
      getDb().prepare("SELECT COUNT(*) AS n FROM memories_fts").get() as { n: number }
    ).n;
    const rows = (
      getDb().prepare("SELECT COUNT(*) AS n FROM memories").get() as { n: number }
    ).n;
    expect(before).toBe(rows);
  });

  it("rebuilds a legacy unicode61 FTS into the trigram tokenizer on upgrade", () => {
    // Simulate a pre-v2 database: replace the FTS index with the old
    // unicode61 tokenizer (a CJK run is one opaque token).
    getDb().exec("DROP TABLE memories_fts");
    getDb().exec("CREATE VIRTUAL TABLE memories_fts USING fts5(id UNINDEXED, content)");
    const mig = createMemory({
      workspaceId: "ws-mig",
      kind: "fact",
      content: "メモリ移行テスト",
      provenance: "manual",
      approved: true,
    });
    expect(searchMemories({ workspaceId: "ws-mig", query: "メモリ", limit: 5 })).toHaveLength(0);

    // Reopen at v1 so the v2 migration rebuilds the FTS table and resyncs.
    getDb().pragma("user_version = 1");
    getDb().close();
    getDb();
    expect(searchMemories({ workspaceId: "ws-mig", query: "メモリ", limit: 5 })).toHaveLength(1);
    expect(
      searchMemories({ workspaceId: "ws-mig", query: "移行テスト", limit: 5 }),
    ).toHaveLength(1);

    // The resync must keep the rowcount in step with memories.
    const ftsCount = (
      getDb().prepare("SELECT COUNT(*) AS n FROM memories_fts").get() as { n: number }
    ).n;
    const memCount = (
      getDb().prepare("SELECT COUNT(*) AS n FROM memories").get() as { n: number }
    ).n;
    expect(ftsCount).toBe(memCount);
  });
});
