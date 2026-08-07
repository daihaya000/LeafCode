import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const testDataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-webui-memory-"));
const previousAppData = process.env.APPDATA;
const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDataDir);
process.env.APPDATA = testDataDir;

const {
  approveMemory,
  buildMemoryInjectionBlock,
  countApprovedMemories,
  createMemory,
  deleteMemory,
  findExactDuplicateMemory,
  insertExtractedMemories,
  listMemories,
  memoryContentError,
  memoryInjectionFor,
  searchMemories,
  stripMemoryInjectionBlock,
  toFtsPhrase,
  updateMemory,
} = await import("./memory");
const { getDb } = await import("./db");

afterAll(() => {
  getDb().close();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  homedirSpy.mockRestore();
  rmSync(testDataDir, { recursive: true, force: true });
});

describe("memory CRUD + injection", () => {
  it("inserts and reads a memory with TEXT id", () => {
    const created = createMemory({
      workspaceId: "ws-1",
      kind: "fact",
      content: "Use pnpm not npm.",
      provenance: "manual",
      approved: true,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.approved).toBe(true);
    const read = listMemories({ workspaceId: "ws-1" });
    expect(read).toHaveLength(1);
    expect(read[0].content).toBe("Use pnpm not npm.");
  });

  it("rejects invalid kind and over-length content", () => {
    expect(() =>
      createMemory({
        workspaceId: "ws-1",
        kind: "nope" as unknown as "fact",
        content: "x",
        provenance: "manual",
      }),
    ).toThrow(RangeError);
    expect(() =>
      createMemory({
        workspaceId: "ws-1",
        kind: "fact",
        content: "y".repeat(2001),
        provenance: "manual",
      }),
    ).toThrow(RangeError);
    expect(memoryContentError("   ")).toBeTruthy();
  });

  it("approves a candidate and hides unapproved from search/injection", () => {
    const cand = createMemory({
      workspaceId: "ws-1",
      kind: "lesson",
      content: "always run tests before commit",
      provenance: "auto-extract",
      approved: false,
    });
    expect(searchMemories({ workspaceId: "ws-1", query: "tests", limit: 10 })).toHaveLength(0);
    expect(memoryInjectionFor("ws-1")).not.toContain("always run tests before commit");
    approveMemory(cand.id);
    expect(countApprovedMemories("ws-1")).toBe(2);
    const found = searchMemories({ workspaceId: "ws-1", query: "tests", limit: 10 });
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(cand.id);
    // The search bump is applied to the row, not to the returned snapshot.
    const reloaded = listMemories({ workspaceId: "ws-1" }).find((m) => m.id === cand.id);
    expect(reloaded?.useCount).toBe(1);
  });

  it("updates and deletes", () => {
    const m = createMemory({
      workspaceId: "ws-1",
      kind: "fact",
      content: "old",
      provenance: "manual",
    });
    const upd = updateMemory(m.id, { content: "new", kind: "preference" });
    expect(upd?.content).toBe("new");
    expect(upd?.kind).toBe("preference");
    expect(() => updateMemory(m.id, { content: "" })).toThrow(RangeError);
    expect(deleteMemory(m.id)).toBe(true);
    const present = (
      getDb().prepare("SELECT COUNT(*) AS n FROM memories WHERE id = ?").get(m.id) as {
        n: number;
      }
    ).n;
    expect(present).toBe(0);
  });

  it("dedupes exact duplicates in batch insert", () => {
    const r = insertExtractedMemories({
      workspaceId: "ws-1",
      provenance: "auto-extract",
      items: [
        { kind: "fact", content: "dup content" },
        { kind: "fact", content: "dup content" },
        { kind: "lesson", content: "unique" },
      ],
    });
    expect(r.created).toBe(2);
    expect(r.skipped).toBe(1);
    expect(findExactDuplicateMemory("ws-1", "dup content")).toBeDefined();
  });

  it("builds the injection block, capped at 8, most-used first", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      kind: "fact" as const,
      content: `#${i}`,
    }));
    const block = buildMemoryInjectionBlock(items);
    expect(block).toContain("<workspace-memory>");
    expect(block.match(/- \[fact\]/g)).toHaveLength(8);
    expect(buildMemoryInjectionBlock([])).toBe("");
  });

  it("escapes quotes into a safe FTS phrase", () => {
    expect(toFtsPhrase(`say "hi"`)).toBe(`"say ""hi"""`);
    expect(toFtsPhrase("")).toBe('""');
  });

  it("memoryInjectionFor bumps use_count on the injected rows", () => {
    const a = createMemory({ workspaceId: "ws-3", kind: "fact", content: "alpha", provenance: "manual", approved: true });
    const b = createMemory({ workspaceId: "ws-3", kind: "lesson", content: "beta", provenance: "manual", approved: true });
    const block = memoryInjectionFor("ws-3");
    expect(block).toContain("alpha");
    expect(block).toContain("beta");
    const reloaded = listMemories({ workspaceId: "ws-3" });
    expect(reloaded.find((m) => m.id === a.id)?.useCount).toBe(1);
    expect(reloaded.find((m) => m.id === b.id)?.useCount).toBe(1);

    createMemory({ workspaceId: "ws-4", kind: "fact", content: "other ws", provenance: "manual", approved: true });
    expect(memoryInjectionFor("ws-4")).toContain("other ws");
    // Empty workspace yields "".
    expect(memoryInjectionFor("ws-empty")).toBe("");
  });

  it("strips only the leading workspace-memory block at render time", () => {
    const block = buildMemoryInjectionBlock([{ kind: "fact", content: "secret" }]);
    expect(stripMemoryInjectionBlock(`${block}\nUser question`)).toBe("User question");
    expect(stripMemoryInjectionBlock(`prefix\n${block}\nrest`)).toBe(`prefix\n${block}\nrest`);
    expect(stripMemoryInjectionBlock(block)).toBe("");
    expect(stripMemoryInjectionBlock("plain text")).toBe("plain text");
  });
});