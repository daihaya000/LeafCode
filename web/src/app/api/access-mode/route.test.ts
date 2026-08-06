import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getWorkspace, latestBindings, listSessionBindings, setSessionEditPermission } =
  vi.hoisted(() => ({
    getWorkspace: vi.fn(),
    latestBindings: vi.fn(),
    listSessionBindings: vi.fn(),
    setSessionEditPermission: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({ getWorkspace, latestBindings, listSessionBindings }));
vi.mock("@/lib/oc-server", () => ({
  OcError: class OcError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
}));
vi.mock("@/lib/opencode-access-mode", () => ({ setSessionEditPermission }));

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
  });

  it("applies the edit ruleset to the task's live OpenCode session", async () => {
    getWorkspace.mockReturnValue({ absolute_path: "C:\\worktree" });
    latestBindings.mockReturnValue(
      new Map([["task-1", { opencode_session_id: "ses_1" }]]),
    );

    const response = await POST(request({ taskId: "task-1", mode: "ask" }));

    expect(response.status).toBe(200);
    expect(setSessionEditPermission).toHaveBeenCalledWith(
      "C:\\worktree",
      "ses_1",
      "ask",
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
    );
  });

  it("returns 404 when sessionId is not bound to the task", async () => {
    getWorkspace.mockReturnValue({ absolute_path: "C:\\worktree" });
    listSessionBindings.mockReturnValue([{ opencode_session_id: "ses_1" }]);

    const response = await POST(
      request({ taskId: "task-1", sessionId: "ses_other", mode: "ask" }),
    );

    expect(response.status).toBe(404);
    expect(setSessionEditPermission).not.toHaveBeenCalled();
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
