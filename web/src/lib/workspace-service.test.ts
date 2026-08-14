import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getWorkspace,
  getDb,
  listSessionBindings,
  deleteWorkspace,
  setWorkspaceStatus,
  removeAllowedRoot,
  addAllowedRoot,
  createWorkspace,
  removeWorktree,
  runGit,
  createTemporaryCopy,
  removeTemporaryCopy,
  resolveTemporaryCopyPath,
  persistProjectSessions,
  ocServer,
  assertAllowedDirectory,
  getSetting,
} = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  getDb: vi.fn(),
  listSessionBindings: vi.fn(),
  deleteWorkspace: vi.fn(),
  setWorkspaceStatus: vi.fn(),
  removeAllowedRoot: vi.fn(),
  addAllowedRoot: vi.fn(),
  createWorkspace: vi.fn(),
  removeWorktree: vi.fn(),
  runGit: vi.fn(),
  createTemporaryCopy: vi.fn(),
  removeTemporaryCopy: vi.fn(),
  resolveTemporaryCopyPath: vi.fn((p: string) => p),
  persistProjectSessions: vi.fn(),
  ocServer: vi.fn(),
  assertAllowedDirectory: vi.fn(),
  getSetting: vi.fn<(key: string) => string | null>(() => null),
}));

vi.mock("./db", () => ({
  getWorkspace,
  getDb,
  listSessionBindings,
  deleteWorkspace,
  setWorkspaceStatus,
  removeAllowedRoot,
  addAllowedRoot,
  createWorkspace,
  deleteProject: vi.fn(),
  listProjects: vi.fn(),
  listWorkspaces: vi.fn(),
  getSetting,
}));

vi.mock("./git", () => ({
  addWorktree: vi.fn(),
  removeWorktree,
  runGit,
}));

vi.mock("./copy", () => ({
  createTemporaryCopy,
  removeTemporaryCopy,
  resolveTemporaryCopyPath,
}));

vi.mock("./project-session-sync", () => ({
  persistProjectSessions,
}));

vi.mock("./project-session-store", () => ({
  deleteProjectManifest: vi.fn(),
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
  assertAllowedDirectory,
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

import {
  configureAgentGitIdentity,
  destroyWorkspace,
  provisionWorkspace,
  ServiceError,
} from "./workspace-service";

const WT = "C:\\Users\\testuser\\AppData\\Roaming\\leafcode\\worktrees\\p1\\task-1";

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
  getSetting.mockReturnValue(null);
  getDb.mockReturnValue({
    prepare: (sql: string) => ({
      get: () =>
        sql.includes("FROM projects") ? { root_path: "C:\\repo" } : undefined,
    }),
    // Mirrors better-sqlite3's Database.transaction(fn): returns a function
    // that, when called, runs fn synchronously and returns its result.
    transaction: (fn: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) => fn(...args),
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
  runGit.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  ocServer.mockResolvedValue({});
  assertAllowedDirectory.mockReturnValue({ ok: true });
});

describe("provisionWorkspace current_folder path binding", () => {
  it("binds absolutePath to the project root and ignores client paths", async () => {
    createWorkspace.mockImplementation((row: { absolutePath: string }) => ({
      id: "ws-new",
      project_id: "p1",
      display_name: "task",
      absolute_path: row.absolutePath,
      isolation: "current_folder",
      base_branch: null,
      worktree_path: null,
      status: "active",
      created_at: "2026-07-26T00:00:00Z",
    }));

    const { workspace } = await provisionWorkspace({
      projectId: "p1",
      isolation: "current_folder",
      displayName: "task",
    });

    expect(createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        absolutePath: "C:\\repo",
        isolation: "current_folder",
      }),
    );
    expect(workspace.absolute_path).toBe("C:\\repo");
  });
});

describe("configureAgentGitIdentity", () => {
  it("stores a worktree-scoped identity for the selected agent", async () => {
    await configureAgentGitIdentity({
      repoRoot: "C:\\repo",
      workspacePath: WT,
      isolation: "git_worktree",
      agentName: "lead-programmer",
    });

    expect(runGit).toHaveBeenNthCalledWith(
      1,
      "C:\\repo",
      ["config", "extensions.worktreeConfig", "true"],
    );
    expect(runGit).toHaveBeenNthCalledWith(
      2,
      WT,
      ["config", "--worktree", "user.name", "lead-programmer"],
    );
    expect(runGit).toHaveBeenNthCalledWith(
      3,
      WT,
      ["config", "--worktree", "user.email", "lead-programmer@opencode.local"],
    );
  });

  it("prefers the configured real-user identity over the agent name", async () => {
    getSetting.mockImplementation((key: string) =>
      key === "commit-author-name"
        ? "Daichi"
        : key === "commit-author-email"
          ? "daichi@estprime.com"
          : null,
    );

    await configureAgentGitIdentity({
      repoRoot: "C:\\repo",
      workspacePath: WT,
      isolation: "git_worktree",
      agentName: "lead-programmer",
    });

    expect(runGit).toHaveBeenNthCalledWith(
      2,
      WT,
      ["config", "--worktree", "user.name", "Daichi"],
    );
    expect(runGit).toHaveBeenNthCalledWith(
      3,
      WT,
      ["config", "--worktree", "user.email", "daichi@estprime.com"],
    );
  });

  it("does not change Git configuration for a current-folder workspace", async () => {
    await configureAgentGitIdentity({
      repoRoot: "C:\\repo",
      workspacePath: "C:\\repo",
      isolation: "current_folder",
      agentName: "build",
    });

    expect(runGit).not.toHaveBeenCalled();
  });
});

describe("provisionWorkspace temporary_copy rollback", () => {
  it("removes the exact copy and allowlist entry when allowlisting fails", async () => {
    const copyPath = "C:\\data\\copies\\ws1";
    createTemporaryCopy.mockReturnValue(copyPath);
    addAllowedRoot.mockImplementation(() => {
      throw new Error("allowlist write failed");
    });

    await expect(
      provisionWorkspace({ projectId: "p1", isolation: "temporary_copy" }),
    ).rejects.toMatchObject({
      message: "allowlist write failed",
      status: 500,
    });

    expect(removeAllowedRoot).toHaveBeenCalledWith(copyPath);
    expect(removeTemporaryCopy).toHaveBeenCalledWith(copyPath, expect.any(String));
  });
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

  it("does not removeAllowedRoot for an untrusted temporary_copy path", async () => {
    getWorkspace.mockReturnValue(
      gitWorktreeRow({
        isolation: "temporary_copy",
        worktree_path: "C:\\repo",
        absolute_path: "C:\\repo",
      }),
    );
    resolveTemporaryCopyPath.mockImplementationOnce(() => {
      throw new Error("refusing to delete path outside copies root");
    });

    await destroyWorkspace("ws1");

    expect(removeTemporaryCopy).not.toHaveBeenCalled();
    expect(removeAllowedRoot).not.toHaveBeenCalled();
    expect(deleteWorkspace).toHaveBeenCalledWith("ws1");
  });
});

describe("archiveWorkspace", () => {
  it("sets workspace status to archived and persists sessions", async () => {
    getWorkspace.mockReturnValue(gitWorktreeRow());
    setWorkspaceStatus.mockClear();
    persistProjectSessions.mockClear();

    const { archiveWorkspace } = await import("./workspace-service");
    await archiveWorkspace("ws1");

    expect(setWorkspaceStatus).toHaveBeenCalledWith("ws1", "archived");
    expect(persistProjectSessions).toHaveBeenCalledWith("p1");
  });

  it("throws 404 when workspace does not exist", async () => {
    getWorkspace.mockReturnValue(undefined);

    const { archiveWorkspace } = await import("./workspace-service");
    await expect(archiveWorkspace("missing")).rejects.toThrow(ServiceError);
    await expect(archiveWorkspace("missing")).rejects.toMatchObject({
      status: 404,
    });
    expect(setWorkspaceStatus).not.toHaveBeenCalled();
  });
});

describe("restoreWorkspace", () => {
  it("sets workspace status to active and persists sessions", async () => {
    getWorkspace.mockReturnValue(gitWorktreeRow({ status: "archived" }));
    setWorkspaceStatus.mockClear();
    persistProjectSessions.mockClear();

    const { restoreWorkspace } = await import("./workspace-service");
    await restoreWorkspace("ws1");

    expect(setWorkspaceStatus).toHaveBeenCalledWith("ws1", "active");
    expect(persistProjectSessions).toHaveBeenCalledWith("p1");
  });

  it("throws 404 when workspace does not exist", async () => {
    getWorkspace.mockReturnValue(undefined);

    const { restoreWorkspace } = await import("./workspace-service");
    await expect(restoreWorkspace("missing")).rejects.toThrow(ServiceError);
    await expect(restoreWorkspace("missing")).rejects.toMatchObject({
      status: 404,
    });
    expect(setWorkspaceStatus).not.toHaveBeenCalled();
  });
});
