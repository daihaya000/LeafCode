import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dataDirMock = vi.hoisted(() => vi.fn());
vi.mock("./paths", () => ({ dataDir: dataDirMock }));

import {
  readGitRestoreProgress,
  readUpdateRecord,
  writeGitRestoreProgress,
  writeUpdateRecord,
} from "./install-state";

describe("install-state", () => {
  let tmpDataDir: string;
  const root = "C:\\fake-install-root";

  beforeEach(() => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "install-state-test-"));
    dataDirMock.mockReturnValue(tmpDataDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns null before anything has been written", () => {
    expect(readGitRestoreProgress(root)).toBeNull();
    expect(readUpdateRecord(root)).toBeNull();
  });

  it("round-trips a git restore progress record", () => {
    writeGitRestoreProgress(root, {
      phase: "cloned",
      defaultBranch: "master",
      clonedAt: "2026-08-04T00:00:00.000Z",
      lastAttemptAt: "2026-08-04T00:00:00.000Z",
      attemptCount: 1,
    });
    expect(readGitRestoreProgress(root)).toEqual({
      phase: "cloned",
      defaultBranch: "master",
      clonedAt: "2026-08-04T00:00:00.000Z",
      lastAttemptAt: "2026-08-04T00:00:00.000Z",
      attemptCount: 1,
    });
  });

  it("merges partial patches onto the existing progress record", () => {
    writeGitRestoreProgress(root, {
      phase: "cloned",
      defaultBranch: "master",
      attemptCount: 1,
    });
    writeGitRestoreProgress(root, { phase: "done", doneAt: "2026-08-04T00:05:00.000Z" });
    expect(readGitRestoreProgress(root)).toEqual({
      phase: "done",
      defaultBranch: "master",
      doneAt: "2026-08-04T00:05:00.000Z",
      attemptCount: 1,
    });
  });

  it("leaves phase undefined until a clone actually succeeds", () => {
    writeGitRestoreProgress(root, { lastError: "network down", lastAttemptAt: "t1", attemptCount: 1 });
    const progress = readGitRestoreProgress(root);
    expect(progress?.phase).toBeUndefined();
    expect(progress?.lastError).toBe("network down");
  });

  it("round-trips an update record independently of git restore progress", () => {
    writeGitRestoreProgress(root, { phase: "cloned", attemptCount: 1 });
    writeUpdateRecord(root, { commit: "abc123", fetchedAt: "2026-08-04T00:00:00.000Z", source: "zip-update" });
    expect(readUpdateRecord(root)).toEqual({
      commit: "abc123",
      fetchedAt: "2026-08-04T00:00:00.000Z",
      source: "zip-update",
    });
    expect(readGitRestoreProgress(root)?.phase).toBe("cloned");
  });

  it("keys state by project root so two installs don't collide", () => {
    const other = "C:\\another-install-root";
    writeUpdateRecord(root, { commit: "aaa", fetchedAt: "t", source: "zip-update" });
    writeUpdateRecord(other, { commit: "bbb", fetchedAt: "t", source: "zip-update" });
    expect(readUpdateRecord(root)?.commit).toBe("aaa");
    expect(readUpdateRecord(other)?.commit).toBe("bbb");
  });
});
