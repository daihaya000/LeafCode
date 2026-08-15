import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const testDataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-webui-goal-memory-"));
const previousAppData = process.env.APPDATA;
const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDataDir);
process.env.APPDATA = testDataDir;

const { getDb, setSetting } = await import("@/lib/db");

vi.mock("@/lib/memory-extract", () => ({
  runMemoryExtraction: vi.fn(async () => ({ created: 0, skipped: 0, errors: [] })),
}));

const { runMemoryExtraction } = await import("@/lib/memory-extract");
const { MEMORY_ENABLED_SETTING_KEY } = await import("@/lib/memory-settings");
const {
  isAutoExtractEnabled,
  scheduleAutoExtractAfterGoalCompleted,
  isMemoryWriteApprovalEnabled,
  AUTO_EXTRACT_SETTING_KEY,
  WRITE_APPROVAL_SETTING_KEY,
} = await import("@/lib/goal-memory-hook");

const loop = {
  id: "loop-1",
  workspaceId: "ws-1",
  sessionId: "ses-1",
} as never;

afterAll(() => {
  getDb().close();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  homedirSpy.mockRestore();
  rmSync(testDataDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.mocked(runMemoryExtraction).mockClear();
});

describe("goal-memory-hook", () => {
  it("enabled by default", () => {
    expect(isAutoExtractEnabled()).toBe(true);
  });

  it("respects the disable setting", () => {
    setSetting(AUTO_EXTRACT_SETTING_KEY, "0");
    expect(isAutoExtractEnabled()).toBe(false);
    setSetting(AUTO_EXTRACT_SETTING_KEY, "1");
    expect(isAutoExtractEnabled()).toBe(true);
  });

  it("schedules extraction for a completed loop", () => {
    scheduleAutoExtractAfterGoalCompleted(loop);
    expect(vi.mocked(runMemoryExtraction)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runMemoryExtraction)).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      sessionId: "ses-1",
      trigger: "goal-completed",
    });
  });

  it("does nothing when extraction is disabled", () => {
    setSetting(AUTO_EXTRACT_SETTING_KEY, "0");
    scheduleAutoExtractAfterGoalCompleted(loop);
    expect(vi.mocked(runMemoryExtraction)).not.toHaveBeenCalled();
    setSetting(AUTO_EXTRACT_SETTING_KEY, "1");
  });

  it("does nothing when the memory master switch is off", () => {
    setSetting(MEMORY_ENABLED_SETTING_KEY, "0");
    expect(isAutoExtractEnabled()).toBe(false);
    scheduleAutoExtractAfterGoalCompleted(loop);
    expect(vi.mocked(runMemoryExtraction)).not.toHaveBeenCalled();
    setSetting(MEMORY_ENABLED_SETTING_KEY, "1");
  });

  it("skips when the loop has no session binding", () => {
    scheduleAutoExtractAfterGoalCompleted({ workspaceId: "ws-1", sessionId: "" } as never);
    expect(vi.mocked(runMemoryExtraction)).not.toHaveBeenCalled();
  });

  describe("write approval gate", () => {
    it("is disabled by default (auto-commit)", () => {
      expect(isMemoryWriteApprovalEnabled()).toBe(false);
    });

    it("is enabled when the setting is '1'", () => {
      setSetting(WRITE_APPROVAL_SETTING_KEY, "1");
      expect(isMemoryWriteApprovalEnabled()).toBe(true);
      setSetting(WRITE_APPROVAL_SETTING_KEY, "");
      expect(isMemoryWriteApprovalEnabled()).toBe(false);
    });
  });
});
