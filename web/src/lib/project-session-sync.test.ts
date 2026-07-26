import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  dataDir: "",
  manifest: null as unknown,
  imported: [] as { id: string; worktreePath?: string | null }[],
  bound: [] as { workspaceId: string; sessionId: string }[],
  existingWorkspace: null as { id: string; project_id: string } | null,
  importReturns: true as boolean,
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
  bindSession: (workspaceId: string, opencodeSessionId: string) => {
    h.bound.push({ workspaceId, sessionId: opencodeSessionId });
  },
  getWorkspace: (id: string) =>
    h.existingWorkspace?.id === id ? h.existingWorkspace : undefined,
  importWorkspaceRow: (row: { id: string }) => {
    if (!h.importReturns) return false;
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
  h.bound.length = 0;
  h.existingWorkspace = null;
  h.importReturns = true;
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

  it("skips a worktree whose path equals the project root (root coincidence)", () => {
    h.manifest = worktreeEntry(ROOT);
    const res = restoreProjectFromManifest(ROOT, "p1");
    expect(res.workspaces).toBe(0);
    expect(h.imported).toHaveLength(0);
  });

  it("skips a project root nested under worktreeBase before the allow-list OR", () => {
    const worktreeBase = path.join(h.dataDir, "worktrees");
    const rootPath = path.join(worktreeBase, "repo");
    h.manifest = worktreeEntry(rootPath);
    const res = restoreProjectFromManifest(rootPath, "p1");
    expect(res.workspaces).toBe(0);
    expect(h.imported).toHaveLength(0);
  });

  it("skips a worktree path equal to worktreeBase", () => {
    const worktreeBase = path.join(h.dataDir, "worktrees");
    h.manifest = worktreeEntry(worktreeBase);
    const res = restoreProjectFromManifest(ROOT, "p1");
    expect(res.workspaces).toBe(0);
    expect(h.imported).toHaveLength(0);
  });

  it("skips a worktree whose path escapes both trusted bases", () => {
    h.manifest = worktreeEntry(path.join(os.tmpdir(), "elsewhere", "wt1"));
    const res = restoreProjectFromManifest(ROOT, "p1");
    expect(res.workspaces).toBe(0);
    expect(h.imported).toHaveLength(0);
  });
});

describe("restoreProjectFromManifest temporary_copy path guard", () => {
  it("imports a copy under <dataDir>/copies/<id>", () => {
    const copyPath = path.join(h.dataDir, "copies", "ws1");
    h.manifest = {
      project: { name: "p", rootPath: ROOT },
      workspaces: [
        {
          id: "ws1",
          displayName: "task",
          absolutePath: copyPath,
          isolation: "temporary_copy",
          baseBranch: null,
          worktreePath: copyPath,
          status: "active",
          createdAt: "2026-07-18T00:00:00Z",
          sessions: [],
        },
      ],
    };
    const res = restoreProjectFromManifest(ROOT, "p1");
    expect(res.workspaces).toBe(1);
  });

  it("skips a temporary_copy whose path is an allowlisted project root", () => {
    h.manifest = {
      project: { name: "p", rootPath: ROOT },
      workspaces: [
        {
          id: "ws1",
          displayName: "task",
          absolutePath: ROOT,
          isolation: "temporary_copy",
          baseBranch: null,
          worktreePath: ROOT,
          status: "active",
          createdAt: "2026-07-18T00:00:00Z",
          sessions: [],
        },
      ],
    };
    const res = restoreProjectFromManifest(ROOT, "p1");
    expect(res.workspaces).toBe(0);
    expect(h.imported).toHaveLength(0);
  });
});

describe("restoreProjectFromManifest absolutePath guard", () => {
  it("skips current_folder when absolutePath escapes the project root", () => {
    h.manifest = {
      project: { name: "p", rootPath: ROOT },
      workspaces: [
        {
          id: "ws1",
          displayName: "task",
          absolutePath: path.join(os.tmpdir(), "elsewhere"),
          isolation: "current_folder",
          baseBranch: null,
          worktreePath: null,
          status: "active",
          createdAt: "2026-07-18T00:00:00Z",
          sessions: [],
        },
      ],
    };
    const res = restoreProjectFromManifest(ROOT, "p1");
    expect(res.workspaces).toBe(0);
    expect(h.imported).toHaveLength(0);
  });

  it("skips git_worktree when absolutePath disagrees with a valid worktreePath", () => {
    const wt = path.join(ROOT, ".webui-worktrees", "wt1");
    h.manifest = {
      project: { name: "p", rootPath: ROOT },
      workspaces: [
        {
          id: "ws1",
          displayName: "task",
          absolutePath: path.join(os.tmpdir(), "evil"),
          isolation: "git_worktree",
          baseBranch: "main",
          worktreePath: wt,
          status: "active",
          createdAt: "2026-07-18T00:00:00Z",
          sessions: [],
        },
      ],
    };
    const res = restoreProjectFromManifest(ROOT, "p1");
    expect(res.workspaces).toBe(0);
    expect(h.imported).toHaveLength(0);
  });

  it("skips git_worktree when worktreePath is missing even if absolutePath looks nested", () => {
    h.manifest = {
      project: { name: "p", rootPath: ROOT },
      workspaces: [
        {
          id: "ws1",
          displayName: "task",
          absolutePath: path.join(ROOT, ".webui-worktrees", "wt1"),
          isolation: "git_worktree",
          baseBranch: "main",
          worktreePath: null,
          status: "active",
          createdAt: "2026-07-18T00:00:00Z",
          sessions: [],
        },
      ],
    };
    const res = restoreProjectFromManifest(ROOT, "p1");
    expect(res.workspaces).toBe(0);
    expect(h.imported).toHaveLength(0);
  });

  it("imports current_folder bound to the project root", () => {
    h.manifest = {
      project: { name: "p", rootPath: ROOT },
      workspaces: [
        {
          id: "ws1",
          displayName: "task",
          absolutePath: ROOT,
          isolation: "current_folder",
          baseBranch: null,
          worktreePath: null,
          status: "active",
          createdAt: "2026-07-18T00:00:00Z",
          sessions: [],
        },
      ],
    };
    const res = restoreProjectFromManifest(ROOT, "p1");
    expect(res.workspaces).toBe(1);
    expect(h.imported).toHaveLength(1);
  });

  it("stores a resolved worktreePath rather than a trailing .. form", () => {
    const wt = path.join(ROOT, ".webui-worktrees", "wt1", "x", "..");
    h.manifest = {
      project: { name: "p", rootPath: ROOT },
      workspaces: [
        {
          id: "ws1",
          displayName: "task",
          absolutePath: path.resolve(wt),
          isolation: "git_worktree",
          baseBranch: "main",
          worktreePath: wt,
          status: "active",
          createdAt: "2026-07-18T00:00:00Z",
          sessions: [],
        },
      ],
    };
    const res = restoreProjectFromManifest(ROOT, "p1");
    expect(res.workspaces).toBe(1);
    expect(h.imported[0]).toMatchObject({
      worktreePath: path.resolve(wt),
    });
    expect(String(h.imported[0]?.worktreePath)).not.toMatch(/[/\\]\.\.$/);
  });
});

describe("restoreProjectFromManifest workspace id collision", () => {
  it("does not bind sessions when workspace id belongs to another project", () => {
    h.importReturns = false;
    h.existingWorkspace = { id: "ws-shared", project_id: "other-project" };
    h.manifest = {
      project: { name: "p", rootPath: ROOT },
      workspaces: [
        {
          id: "ws-shared",
          displayName: "task",
          absolutePath: ROOT,
          isolation: "current_folder",
          baseBranch: null,
          worktreePath: null,
          status: "active",
          createdAt: "2026-07-18T00:00:00Z",
          sessions: [
            {
              opencodeSessionId: "ses_x",
              title: "x",
              updatedAt: "2026-07-18T00:00:00Z",
            },
          ],
        },
      ],
    };
    const res = restoreProjectFromManifest(ROOT, "p1");
    expect(res.workspaces).toBe(0);
    expect(res.sessions).toBe(0);
    expect(h.bound).toHaveLength(0);
  });

  it("binds sessions when workspace already exists for the same project", () => {
    h.importReturns = false;
    h.existingWorkspace = { id: "ws-shared", project_id: "p1" };
    h.manifest = {
      project: { name: "p", rootPath: ROOT },
      workspaces: [
        {
          id: "ws-shared",
          displayName: "task",
          absolutePath: ROOT,
          isolation: "current_folder",
          baseBranch: null,
          worktreePath: null,
          status: "active",
          createdAt: "2026-07-18T00:00:00Z",
          sessions: [
            {
              opencodeSessionId: "ses_x",
              title: "x",
              updatedAt: "2026-07-18T00:00:00Z",
            },
          ],
        },
      ],
    };
    const res = restoreProjectFromManifest(ROOT, "p1");
    expect(res.workspaces).toBe(0);
    expect(res.sessions).toBe(1);
    expect(h.bound).toEqual([{ workspaceId: "ws-shared", sessionId: "ses_x" }]);
  });
});
