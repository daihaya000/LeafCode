import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getWorkspace,
  latestBindings,
  listSessionBindings,
  setSessionEditPermission,
  listDescendantSessionIds,
  isSessionUnderRoots,
} = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  latestBindings: vi.fn(),
  listSessionBindings: vi.fn(),
  setSessionEditPermission: vi.fn(),
  listDescendantSessionIds: vi.fn(),
  isSessionUnderRoots: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getWorkspace, latestBindings, listSessionBindings }));
vi.mock("@/lib/oc-server", () => ({
  OcError: class OcError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
}));
vi.mock("@/lib/opencode-access-mode", () => ({
  setSessionEditPermission,
  listDescendantSessionIds,
  isSessionUnderRoots,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/access-mode", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/access-mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDescendantSessionIds.mockResolvedValue([]);
    isSessionUnderRoots.mockResolvedValue(false);
    listSessionBindings.mockReturnValue([]);
  });

  it("applies the edit ruleset to the task's live OpenCode session", async () => {
    getWorkspace.mockReturnValue({ absolute_path: "C:\\worktree" });
    listSessionBindings.mockReturnValue([{ opencode_session_id: "ses_1" }]);
    latestBindings.mockReturnValue(
      new Map([["task-1", { opencode_session_id: "ses_1" }]]),
    );

    const response = await POST(request({ taskId: "task-1", mode: "ask" }));

    expect(response.status).toBe(200);
    expect(setSessionEditPermission).toHaveBeenCalledWith(
      "C:\\worktree",
      "ses_1",
      "ask",
      [],
    );
  });

  it("applies the ruleset to an explicit sessionId belonging to the task", async () => {
    getWorkspace.mockReturnValue({ absolute_path: "C:\\worktree" });
    listSessionBindings.mockReturnValue([
      { opencode_session_id: "ses_old" },
      { opencode_session_id: "ses_target" },
    ]);
    latestBindings.mockReturnValue(
      new Map([["task-1", { opencode_session_id: "ses_old" }]]),
    );

    const response = await POST(
      request({ taskId: "task-1", sessionId: "ses_target", mode: "full" }),
    );

    expect(response.status).toBe(200);
    expect(setSessionEditPermission).toHaveBeenCalledWith(
      "C:\\worktree",
      "ses_target",
      "full",
      [],
    );
  });

  it("returns 404 when sessionId is not bound to the task", async () => {
    getWorkspace.mockReturnValue({ absolute_path: "C:\\worktree" });
    listSessionBindings.mockReturnValue([{ opencode_session_id: "ses_1" }]);
    listDescendantSessionIds.mockResolvedValue([]);
    isSessionUnderRoots.mockResolvedValue(false);

    const response = await POST(
      request({ taskId: "task-1", sessionId: "ses_other", mode: "ask" }),
    );

    expect(response.status).toBe(404);
    expect(setSessionEditPermission).not.toHaveBeenCalled();
  });

  it("applies the ruleset to a child session of a bound parent", async () => {
    getWorkspace.mockReturnValue({ absolute_path: "C:\\worktree" });
    listSessionBindings.mockReturnValue([{ opencode_session_id: "ses_parent" }]);
    listDescendantSessionIds.mockResolvedValue(["ses_child"]);
    latestBindings.mockReturnValue(
      new Map([["task-1", { opencode_session_id: "ses_parent" }]]),
    );

    const response = await POST(
      request({ taskId: "task-1", sessionId: "ses_child", mode: "ask" }),
    );

    expect(response.status).toBe(200);
    expect(listDescendantSessionIds).toHaveBeenCalledWith(
      "C:\\worktree",
      "ses_parent",
    );
    expect(setSessionEditPermission).toHaveBeenCalledWith(
      "C:\\worktree",
      "ses_child",
      "ask",
      [],
    );
  });

  it("applies the ruleset to a nested grandchild session", async () => {
    getWorkspace.mockReturnValue({ absolute_path: "C:\\worktree" });
    listSessionBindings.mockReturnValue([{ opencode_session_id: "ses_parent" }]);
    listDescendantSessionIds.mockResolvedValue(["ses_child", "ses_grand"]);
    latestBindings.mockReturnValue(
      new Map([["task-1", { opencode_session_id: "ses_parent" }]]),
    );

    const response = await POST(
      request({ taskId: "task-1", sessionId: "ses_grand", mode: "ask" }),
    );

    expect(response.status).toBe(200);
    expect(setSessionEditPermission).toHaveBeenCalledWith(
      "C:\\worktree",
      "ses_grand",
      "ask",
      [],
    );
  });

  it("PATCHes ensureSessionIds when /children is still empty after session.created", async () => {
    // Regression: listing lag used to skip the child forever after one empty
    // /children response, leaving OpenCode's default allow ruleset in place.
    getWorkspace.mockReturnValue({ absolute_path: "C:\\worktree" });
    listSessionBindings.mockReturnValue([{ opencode_session_id: "ses_parent" }]);
    latestBindings.mockReturnValue(
      new Map([["task-1", { opencode_session_id: "ses_parent" }]]),
    );
    listDescendantSessionIds.mockResolvedValue([]);
    isSessionUnderRoots.mockImplementation(
      async (_directory: string, sessionId: string) => sessionId === "ses_child",
    );

    const response = await POST(
      request({
        taskId: "task-1",
        sessionId: "ses_parent",
        mode: "ask",
        ensureSessionIds: ["ses_child"],
      }),
    );

    expect(response.status).toBe(200);
    expect(setSessionEditPermission).toHaveBeenCalledWith(
      "C:\\worktree",
      "ses_parent",
      "ask",
      ["ses_child"],
    );
  });

  it("ignores ensureSessionIds that are not under a bound parent", async () => {
    getWorkspace.mockReturnValue({ absolute_path: "C:\\worktree" });
    listSessionBindings.mockReturnValue([{ opencode_session_id: "ses_parent" }]);
    latestBindings.mockReturnValue(
      new Map([["task-1", { opencode_session_id: "ses_parent" }]]),
    );
    isSessionUnderRoots.mockResolvedValue(false);

    const response = await POST(
      request({
        taskId: "task-1",
        sessionId: "ses_parent",
        mode: "ask",
        ensureSessionIds: ["ses_foreign"],
      }),
    );

    expect(response.status).toBe(200);
    expect(setSessionEditPermission).toHaveBeenCalledWith(
      "C:\\worktree",
      "ses_parent",
      "ask",
      [],
    );
  });

  it("returns 404 when the task has no bound session", async () => {
    getWorkspace.mockReturnValue({ absolute_path: "C:\\worktree" });
    latestBindings.mockReturnValue(new Map());

    const response = await POST(request({ taskId: "task-1", mode: "ask" }));

    expect(response.status).toBe(404);
    expect(setSessionEditPermission).not.toHaveBeenCalled();
  });

  it("rejects a missing taskId target", async () => {
    const response = await POST(request({ mode: "ask" }));

    expect(response.status).toBe(400);
    expect(setSessionEditPermission).not.toHaveBeenCalled();
  });

  it("rejects an unknown mode", async () => {
    const response = await POST(request({ taskId: "task-1", mode: "allow" }));

    expect(response.status).toBe(400);
    expect(setSessionEditPermission).not.toHaveBeenCalled();
  });

  it("rejects arbitrary config-shaped fields without touching OpenCode", async () => {
    const response = await POST(
      request({
        taskId: "task-1",
        mode: "ask",
        config: { provider: { arbitrary: {} } },
      }),
    );

    expect(response.status).toBe(400);
    expect(setSessionEditPermission).not.toHaveBeenCalled();
  });
});
