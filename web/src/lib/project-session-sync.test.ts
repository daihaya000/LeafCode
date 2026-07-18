import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  dataDir: "",
  manifest: null as unknown,
  imported: [] as { id: string }[],
}));

vi.mock("./paths", () => ({
  dataDir: () => h.dataDir,
  ensureDataDir: () => undefined,
}));

vi.mock("./db", () => ({
  getProject: () => undefined,
  listProjects: () => [],
  listWorkspaces: () => [],
  listSessionBindings: () => [],
  upsertProject: () => ({ id: "p1" }),
  bindSession: () => undefined,
  importWorkspaceRow: (row: { id: string }) => {
    h.imported.push(row);
    return true;
  },
}));

vi.mock("./project-session-store", () => ({
  emptyManifest: () => ({ workspaces: [] }),
  readProjectManifest: () => h.manifest,
  writeProjectManifest: () => undefined,
}));

import { restoreProjectFromManifest } from "./project-session-sync";

const ROOT = path.join(os.tmpdir(), "pss-test-root");

function worktreeEntry(worktreePath: string) {
  return {
    project: { name: "p", rootPath: ROOT },
    workspaces: [
      {
        id: "ws1",
        displayName: "task",
        absolutePath: worktreePath,
        isolation: "git_worktree",
        baseBranch: "main",
        worktreePath,
        status: "active",
        createdAt: "2026-07-18T00:00:00Z",
        sessions: [],
      },
    ],
  };
}

beforeEach(() => {
  h.dataDir = path.join(os.tmpdir(), "pss-test-data");
  h.manifest = null;
  h.imported.length = 0;
});

describe("restoreProjectFromManifest worktree path guard", () => {
  it("imports a legacy worktree under the project root", () => {
    h.manifest = worktreeEntry(path.join(ROOT, ".webui-worktrees", "wt1"));
    const res = restoreProjectFromManifest(ROOT, "p1");
    expect(res.workspaces).toBe(1);
    expect(h.imported).toHaveLength(1);
  });

  it("imports a worktree under <dataDir>/worktrees (OneDrive-safe location)", () => {
    h.manifest = worktreeEntry(
      path.join(h.dataDir, "worktrees", "p1", "webui__main__task-abc"),
    );
    const res = restoreProjectFromManifest(ROOT, "p1");
    expect(res.workspaces).toBe(1);
    expect(h.imported).toHaveLength(1);
  });

  it("skips a worktree whose path escapes both trusted bases", () => {
    h.manifest = worktreeEntry(path.join(os.tmpdir(), "elsewhere", "wt1"));
    const res = restoreProjectFromManifest(ROOT, "p1");
    expect(res.workspaces).toBe(0);
    expect(h.imported).toHaveLength(0);
  });
});
