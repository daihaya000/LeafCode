import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getWorkspace, latestBindings, listSessionBindings, setSessionTaskPermission } =
  vi.hoisted(() => ({
    getWorkspace: vi.fn(),
    latestBindings: vi.fn(),
    listSessionBindings: vi.fn(),
    setSessionTaskPermission: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({ getWorkspace, latestBindings, listSessionBindings }));
vi.mock("@/lib/oc-server", () => ({
  OcError: class OcError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
}));
vi.mock("@/lib/opencode-task-permission", () => ({ setSessionTaskPermission }));

import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/subagent-permission", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/subagent-permission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies the task ruleset to the task's live OpenCode session", async () => {
    getWorkspace.mockReturnValue({ absolute_path: "C:\\worktree" });
    latestBindings.mockReturnValue(
      new Map([["task-1", { opencode_session_id: "ses_1" }]]),
    );

    const response = await POST(request({ taskId: "task-1", permission: "deny" }));

    expect(response.status).toBe(200);
    expect(setSessionTaskPermission).toHaveBeenCalledWith(
      "C:\\worktree",
      "ses_1",
      "deny",
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
      request({ taskId: "task-1", sessionId: "ses_target", permission: "deny" }),
    );

    expect(response.status).toBe(200);
    expect(setSessionTaskPermission).toHaveBeenCalledWith(
      "C:\\worktree",
      "ses_target",
      "deny",
    );
  });

  it("returns 404 when sessionId is not bound to the task", async () => {
    getWorkspace.mockReturnValue({ absolute_path: "C:\\worktree" });
    listSessionBindings.mockReturnValue([{ opencode_session_id: "ses_1" }]);

    const response = await POST(
      request({ taskId: "task-1", sessionId: "ses_other", permission: "deny" }),
    );

    expect(response.status).toBe(404);
    expect(setSessionTaskPermission).not.toHaveBeenCalled();
  });

  it("returns 404 when the task has no bound session", async () => {
    getWorkspace.mockReturnValue({ absolute_path: "C:\\worktree" });
    latestBindings.mockReturnValue(new Map());

    const response = await POST(request({ taskId: "task-1", permission: "allow" }));

    expect(response.status).toBe(404);
    expect(setSessionTaskPermission).not.toHaveBeenCalled();
  });

  it("rejects a missing taskId target", async () => {
    const response = await POST(request({ permission: "deny" }));

    expect(response.status).toBe(400);
    expect(setSessionTaskPermission).not.toHaveBeenCalled();
  });

  it("rejects arbitrary config-shaped fields without touching OpenCode", async () => {
    const response = await POST(
      request({
        taskId: "task-1",
        permission: "deny",
        config: { provider: { arbitrary: {} } },
      }),
    );

    expect(response.status).toBe(400);
    expect(setSessionTaskPermission).not.toHaveBeenCalled();
  });
});
