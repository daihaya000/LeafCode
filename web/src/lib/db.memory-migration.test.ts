import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const testDataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-webui-mem-mig-"));
const previousAppData = process.env.APPDATA;
const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDataDir);
process.env.APPDATA = testDataDir;

const { getDb } = await import("./db");
const { createMemory, searchMemories, updateMemory, deleteMemory } = await import("./memory");

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

  it("keeps the FTS rowcount in step with memories (no orphan/dup via triggers)", () => {
    const before = (
      getDb().prepare("SELECT COUNT(*) AS n FROM memories_fts").get() as { n: number }
    ).n;
    const rows = (
      getDb().prepare("SELECT COUNT(*) AS n FROM memories").get() as { n: number }
    ).n;
    expect(before).toBe(rows);
  });
});
