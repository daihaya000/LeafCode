import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  projects: [] as { id: string; root_path: string; name: string }[],
  workspaces: [] as { absolute_path: string; worktree_path: string | null }[],
  orphanedRows: [] as unknown[],
  gitWorktrees: {} as Record<string, { path: string; bare: boolean }[]>,
  removeWorktree: vi.fn(async (_arg: unknown) => undefined),
  dataDir: "C:\\data",
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      all: () => {
        if (sql.includes("FROM projects")) return h.projects;
        if (sql.includes("FROM workspaces")) return h.workspaces;
        return [];
      },
      get: () => undefined,
      run: () => undefined,
    }),
  }),
  listWorkspacesByStatus: () => h.orphanedRows,
  removeAllowedRoot: () => undefined,
  setWorkspaceStatus: () => undefined,
  deleteWorkspace: vi.fn(),
}));

vi.mock("@/lib/git", () => ({
  listGitWorktrees: async (repoRoot: string) => h.gitWorktrees[repoRoot] ?? [],
  removeWorktree: (arg: unknown) => h.removeWorktree(arg),
  runGit: async () => ({ code: 0, stdout: "", stderr: "" }),
}));

vi.mock("@/lib/paths", () => ({ dataDir: () => h.dataDir }));
vi.mock("@/lib/project-session-sync", () => ({
  persistProjectSessions: () => undefined,
}));

import { GET, POST } from "./route";

function req(body?: unknown) {
  return new Request("http://x/api/workspaces/orphans", {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as never;
}

function getReq(url = "http://x/api/workspaces/orphans") {
  return { nextUrl: new URL(url) } as never;
}

const STRAY_PATH = "C:\\data\\worktrees\\proj1\\webui__main__task-abc";
const KNOWN_PATH = "C:\\data\\worktrees\\proj1\\webui__main__known-def";

beforeEach(() => {
  vi.clearAllMocks();
  h.projects = [{ id: "proj1", root_path: "C:\\repo", name: "Repo" }];
  h.workspaces = [{ absolute_path: KNOWN_PATH, worktree_path: KNOWN_PATH }];
  h.orphanedRows = [];
  h.gitWorktrees = {
    "C:\\repo": [
      { path: STRAY_PATH, bare: false },
      { path: KNOWN_PATH, bare: false },
    ],
  };
  h.removeWorktree.mockReset();
  h.removeWorktree.mockResolvedValue(undefined);
});

describe("GET /api/workspaces/orphans", () => {
  it("lists a git worktree with no matching workspace row as stray", async () => {
    const res = await GET(getReq());
    const data = (await res.json()) as { stray: { path: string }[] };
    expect(data.stray).toHaveLength(1);
    expect(data.stray[0].path).toBe(STRAY_PATH);
  });

  it("does not list a worktree that has a matching workspace row", async () => {
    const res = await GET(getReq());
    const data = (await res.json()) as { stray: { path: string }[] };
    expect(data.stray.some((s) => s.path === KNOWN_PATH)).toBe(false);
  });
});

describe("POST /api/workspaces/orphans cleanup", () => {
  it("removes stray worktrees via removeWorktree and reports the count", async () => {
    const res = await POST(req({ action: "cleanup" }));
    const data = (await res.json()) as {
      strayRemoved: number;
      strayErrors: string[];
    };
    expect(h.removeWorktree).toHaveBeenCalledWith({
      repoRoot: "C:\\repo",
      worktreePath: STRAY_PATH,
      force: true,
    });
    expect(data.strayRemoved).toBe(1);
    expect(data.strayErrors).toEqual([]);
  });

  it("reports a stray removal failure without throwing", async () => {
    h.removeWorktree.mockRejectedValueOnce(new Error("locked"));
    const res = await POST(req({ action: "cleanup" }));
    const data = (await res.json()) as {
      strayRemoved: number;
      strayErrors: string[];
    };
    expect(data.strayRemoved).toBe(0);
    expect(data.strayErrors).toHaveLength(1);
    expect(data.strayErrors[0]).toContain("locked");
  });

  it("skips stray cleanup when targeting explicit ids", async () => {
    const res = await POST(req({ action: "cleanup", ids: ["ws1"] }));
    const data = (await res.json()) as { strayRemoved: number };
    expect(h.removeWorktree).not.toHaveBeenCalled();
    expect(data.strayRemoved).toBe(0);
  });
});
