import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getWorkspace,
  getDb,
  listSessionBindings,
  deleteWorkspace,
  setWorkspaceStatus,
  removeAllowedRoot,
  removeWorktree,
  runGit,
  removeTemporaryCopy,
  persistProjectSessions,
  ocServer,
} = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  getDb: vi.fn(),
  listSessionBindings: vi.fn(),
  deleteWorkspace: vi.fn(),
  setWorkspaceStatus: vi.fn(),
  removeAllowedRoot: vi.fn(),
  removeWorktree: vi.fn(),
  runGit: vi.fn(),
  removeTemporaryCopy: vi.fn(),
  persistProjectSessions: vi.fn(),
  ocServer: vi.fn(),
}));

vi.mock("./db", () => ({
  getWorkspace,
  getDb,
  listSessionBindings,
  deleteWorkspace,
  setWorkspaceStatus,
  removeAllowedRoot,
  addAllowedRoot: vi.fn(),
  createWorkspace: vi.fn(),
  deleteProject: vi.fn(),
  listProjects: vi.fn(),
  listWorkspaces: vi.fn(),
}));

vi.mock("./git", () => ({
  addWorktree: vi.fn(),
  removeWorktree,
  runGit,
}));

vi.mock("./copy", () => ({
  createTemporaryCopy: vi.fn(),
  removeTemporaryCopy,
}));

vi.mock("./project-session-sync", () => ({
  persistProjectSessions,
}));

vi.mock("./oc-server", () => ({
  OcError: class OcError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  ocServer,
}));

vi.mock("./allowlist", () => ({
  assertAllowedDirectory: vi.fn(),
}));

vi.mock("./devcontainer", () => ({
  detectDevcontainer: vi.fn(),
}));

vi.mock("./paths", () => ({
  dataDir: () => "C:\\data",
  ensureDataDir: () => undefined,
}));

vi.mock("./workspace-branch", () => ({
  makeWorktreeBranchName: () => "webui__main__task-x",
}));

import { destroyWorkspace } from "./workspace-service";

const WT = "C:\\Users\\Daichi\\AppData\\Roaming\\opencode-webui\\worktrees\\p1\\task-1";

function gitWorktreeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws1",
    project_id: "p1",
    display_name: "task",
    absolute_path: WT,
    isolation: "git_worktree",
    base_branch: "main",
    worktree_path: WT,
    status: "active",
    created_at: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getDb.mockReturnValue({
    prepare: () => ({
      get: () => ({ root_path: "C:\\repo" }),
    }),
  });
  deleteWorkspace.mockImplementation((id: string) => getWorkspace(id));
  listSessionBindings.mockReturnValue([
    {
      workspace_id: "ws1",
      opencode_session_id: "ses_stale1",
      title: "t",
      updated_at: "t0",
    },
  ]);
  removeWorktree.mockResolvedValue(undefined);
  runGit.mockResolvedValue({ stdout: "", stderr: "" });
  ocServer.mockResolvedValue({});
});

describe("destroyWorkspace OpenCode session cleanup", () => {
  it("deletes bound OpenCode sessions before removing a git worktree", async () => {
    const row = gitWorktreeRow();
    getWorkspace.mockReturnValue(row);
    const order: string[] = [];
    ocServer.mockImplementation(async (_dir: string, path: string, init?: { method?: string }) => {
      order.push(`${init?.method ?? "GET"} ${path}`);
      return {};
    });
    removeWorktree.mockImplementation(async () => {
      order.push("removeWorktree");
    });

    await destroyWorkspace("ws1");

    expect(ocServer).toHaveBeenCalledWith(WT, "/session/ses_stale1", {
      method: "DELETE",
    });
    expect(order.indexOf("DELETE /session/ses_stale1")).toBeLessThan(
      order.indexOf("removeWorktree"),
    );
    expect(deleteWorkspace).toHaveBeenCalledWith("ws1");
    expect(persistProjectSessions).toHaveBeenCalledWith("p1");
  });

  it("continues worktree removal when OpenCode session delete fails", async () => {
    getWorkspace.mockReturnValue(gitWorktreeRow());
    ocServer.mockRejectedValue(new Error("engine down"));

    await expect(destroyWorkspace("ws1")).resolves.toMatchObject({ id: "ws1" });
    expect(removeWorktree).toHaveBeenCalled();
    expect(deleteWorkspace).toHaveBeenCalledWith("ws1");
  });

  it("does not delete OpenCode sessions for current_folder isolation", async () => {
    getWorkspace.mockReturnValue(
      gitWorktreeRow({
        isolation: "current_folder",
        worktree_path: null,
        absolute_path: "C:\\repo",
      }),
    );

    await destroyWorkspace("ws1");

    expect(ocServer).not.toHaveBeenCalled();
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(deleteWorkspace).toHaveBeenCalledWith("ws1");
  });

  it("deletes bound OpenCode sessions before removing a temporary_copy", async () => {
    const copyPath = "C:\\data\\copies\\ws1";
    getWorkspace.mockReturnValue(
      gitWorktreeRow({
        isolation: "temporary_copy",
        worktree_path: copyPath,
        absolute_path: copyPath,
      }),
    );
    const order: string[] = [];
    ocServer.mockImplementation(async (_dir: string, path: string, init?: { method?: string }) => {
      order.push(`${init?.method ?? "GET"} ${path}`);
      return {};
    });
    removeTemporaryCopy.mockImplementation(() => {
      order.push("removeTemporaryCopy");
    });

    await destroyWorkspace("ws1");

    expect(ocServer).toHaveBeenCalledWith(copyPath, "/session/ses_stale1", {
      method: "DELETE",
    });
    expect(order.indexOf("DELETE /session/ses_stale1")).toBeLessThan(
      order.indexOf("removeTemporaryCopy"),
    );
    expect(removeAllowedRoot).toHaveBeenCalledWith(copyPath);
  });
});
