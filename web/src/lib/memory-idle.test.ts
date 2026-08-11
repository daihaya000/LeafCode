import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const testDataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-webui-mem-idle-"));
const previousAppData = process.env.APPDATA;
const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDataDir);
process.env.APPDATA = testDataDir;

const { getDb, setSetting } = await import("@/lib/db");

vi.mock("@/lib/memory-extract", () => ({
  runMemoryExtraction: vi.fn(async () => ({ created: 0, skipped: 0, errors: [] })),
}));

const { runMemoryExtraction } = await import("@/lib/memory-extract");
const { AUTO_EXTRACT_SETTING_KEY } = await import("@/lib/goal-memory-hook");
const { idleSessionsSince, sweepIdleExtractions, sessionBindingUpdatedAt, IDLE_THRESHOLD_MS } =
  await import("@/lib/memory-idle");

const seedProject = () => {
  getDb()
    .prepare("INSERT OR IGNORE INTO projects (id, name, root_path, created_at) VALUES ('prj-1', 'P', '/root', ?)")
    .run(new Date().toISOString());
};

const seedWorkspace = (id: string) => {
  seedProject();
  getDb()
    .prepare(
      `INSERT INTO workspaces
        (id, project_id, display_name, absolute_path, isolation, status, created_at)
       VALUES (?, 'prj-1', ?, ?, 'standard', 'active', ?)`,
    )
    .run(id, `ws ${id}`, `/ws/${id}`, new Date().toISOString());
};

const seedBinding = (ws: string, ses: string, updatedAt: string) => {
  getDb()
    .prepare(
      `INSERT INTO session_bindings (workspace_id, opencode_session_id, title, updated_at)
       VALUES (?, ?, 'S', ?)`,
    )
    .run(ws, ses, updatedAt);
};

const iso = (ms: number) => new Date(ms).toISOString();

afterAll(() => {
  getDb().close();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  homedirSpy.mockRestore();
  rmSync(testDataDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.mocked(runMemoryExtraction).mockClear();
  setSetting(AUTO_EXTRACT_SETTING_KEY, "1");
  getDb().exec("DELETE FROM memory_idle_extracts");
  getDb().exec("DELETE FROM session_bindings");
  getDb().exec("DELETE FROM workspaces");
});

describe("memory-idle extraction", () => {
  it("reports idle sessions past the threshold but not active ones", () => {
    const now = 2_000_000_000_000;
    seedWorkspace("ws-1");
    seedBinding("ws-1", "ses-idle", iso(now - IDLE_THRESHOLD_MS - 1));
    seedBinding("ws-1", "ses-fresh", iso(now - 1000));

    const idle = idleSessionsSince(now, IDLE_THRESHOLD_MS);
    expect(idle.map((r) => r.sessionId)).toEqual(["ses-idle"]);
    expect(idle[0] && idle[0].idleMs).toBe(IDLE_THRESHOLD_MS + 1);
  });

  it("respects the exact threshold boundary", () => {
    const now = 2_000_000_000_000;
    seedWorkspace("ws-2");
    seedBinding("ws-2", "ses-edge", iso(now - IDLE_THRESHOLD_MS));
    const idle = idleSessionsSince(now, IDLE_THRESHOLD_MS);
    expect(idle.map((r) => r.sessionId)).toEqual(["ses-edge"]);
  });

  it("sweep launches extraction once per session and dedups via ledger", () => {
    const now = 2_000_000_000_000;
    seedWorkspace("ws-3");
    seedBinding("ws-3", "ses-1", iso(now - 2 * IDLE_THRESHOLD_MS));

    const first = sweepIdleExtractions(now, IDLE_THRESHOLD_MS);
    expect(first).toBe(1);
    expect(vi.mocked(runMemoryExtraction)).toHaveBeenCalledWith({
      workspaceId: "ws-3",
      sessionId: "ses-1",
      trigger: "idle",
    });

    // Second sweep: ledged → no relaunch.
    const second = sweepIdleExtractions(now + 60_000, IDLE_THRESHOLD_MS);
    expect(second).toBe(0);
    expect(vi.mocked(runMemoryExtraction)).toHaveBeenCalledTimes(1);
  });

  it("tolerates a workspace row being gone (cascade-safe sweep)", () => {
    const now = 2_000_000_000_000;
    seedWorkspace("ws-3b");
    seedBinding("ws-3b", "ses-1", iso(now - 2 * IDLE_THRESHOLD_MS));
    // Deleting the workspace cascades the binding away, so the sweep just skips.
    getDb().prepare("DELETE FROM workspaces WHERE id = ?").run("ws-3b");
    expect(sweepIdleExtractions(now, IDLE_THRESHOLD_MS)).toBe(0);
    expect(vi.mocked(runMemoryExtraction)).not.toHaveBeenCalled();
  });

  it("does nothing when auto-extract is disabled", () => {
    setSetting(AUTO_EXTRACT_SETTING_KEY, "0");
    const now = 2_000_000_000_000;
    seedWorkspace("ws-4");
    seedBinding("ws-4", "ses-1", iso(now - 2 * IDLE_THRESHOLD_MS));
    expect(sweepIdleExtractions(now, IDLE_THRESHOLD_MS)).toBe(0);
    expect(vi.mocked(runMemoryExtraction)).not.toHaveBeenCalled();
  });

  it("sessionBindingUpdatedAt returns ms or null", () => {
    seedWorkspace("ws-5");
    seedBinding("ws-5", "ses-1", iso(1_000_000_000_000));
    expect(sessionBindingUpdatedAt("ws-5", "ses-1")).toBe(1_000_000_000_000);
    expect(sessionBindingUpdatedAt("ws-5", "nope")).toBeNull();
  });

  it("ledger is durable: a fresh sweep after restart does not relaunch", () => {
    const now = 2_000_000_000_000;
    seedWorkspace("ws-6");
    seedBinding("ws-6", "ses-1", iso(now - 2 * IDLE_THRESHOLD_MS));
    expect(sweepIdleExtractions(now, IDLE_THRESHOLD_MS)).toBe(1);
    // Simulate a new process: same DB, isIdleExtracted still true from the ledger.
    expect(sweepIdleExtractions(now + 3 * IDLE_THRESHOLD_MS, IDLE_THRESHOLD_MS)).toBe(0);
  });
});
