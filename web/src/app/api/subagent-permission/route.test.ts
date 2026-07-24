import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getWorkspace, latestBindings, ocServer, setAgentTaskPermission } = vi.hoisted(
  () => ({
    getWorkspace: vi.fn(),
    latestBindings: vi.fn(),
    ocServer: vi.fn(),
    setAgentTaskPermission: vi.fn(),
  }),
);

vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: vi.fn((directory: string) => ({ ok: true, path: directory })),
}));
vi.mock("@/lib/db", () => ({ getWorkspace, latestBindings }));
vi.mock("@/lib/oc-server", () => ({
  OcError: class OcError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
  ocServer,
}));
vi.mock("@/lib/opencode-task-permission", () => ({ setAgentTaskPermission }));

import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/subagent-permission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/subagent-permission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates only the selected execution agent before a new task", async () => {
    const response = await POST(
      request({ directory: "C:\\repo", agent: "build", permission: "deny" }),
    );

    expect(response.status).toBe(200);
    expect(setAgentTaskPermission).toHaveBeenCalledWith(
      "C:\\repo",
      "build",
      "deny",
    );
    expect(ocServer).not.toHaveBeenCalled();
  });

  it("resolves an existing task's current OpenCode session agent", async () => {
    getWorkspace.mockReturnValue({ absolute_path: "C:\\worktree" });
    latestBindings.mockReturnValue(
      new Map([["task-1", { opencode_session_id: "ses_1" }]]),
    );
    ocServer.mockResolvedValue({ agent: "reviewer" });

    const response = await POST(request({ taskId: "task-1", permission: "allow" }));

    expect(response.status).toBe(200);
    expect(ocServer).toHaveBeenCalledWith("C:\\worktree", "/session/ses_1");
    expect(setAgentTaskPermission).toHaveBeenCalledWith(
      "C:\\worktree",
      "reviewer",
      "allow",
    );
  });

  it("rejects arbitrary config-shaped fields without calling OpenCode", async () => {
    const response = await POST(
      request({
        directory: "C:\\repo",
        agent: "build",
        permission: "deny",
        config: { provider: { arbitrary: {} } },
      }),
    );

    expect(response.status).toBe(400);
    expect(setAgentTaskPermission).not.toHaveBeenCalled();
  });
});
