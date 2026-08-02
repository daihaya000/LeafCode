import { beforeEach, describe, expect, it, vi } from "vitest";

const { ocServer } = vi.hoisted(() => ({ ocServer: vi.fn() }));

vi.mock("@/lib/oc-server", () => ({
  OcError: class OcError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
  ocServer,
}));

import {
  applyWorkflowSessionPermissions,
  setSessionTaskPermission,
} from "./opencode-task-permission";

describe("setSessionTaskPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ocServer.mockResolvedValue(undefined);
  });

  it("PATCHes the session ruleset to deny the task tool", async () => {
    await setSessionTaskPermission("C:\\worktree", "ses_1", "deny");

    expect(ocServer).toHaveBeenCalledTimes(1);
    expect(ocServer).toHaveBeenCalledWith("C:\\worktree", "/session/ses_1", {
      method: "PATCH",
      body: {
        permission: [{ permission: "task", pattern: "*", action: "deny" }],
      },
    });
  });

  it("PATCHes an allow rule so a later toggle wins by last-match", async () => {
    await setSessionTaskPermission("C:\\worktree", "ses_2", "allow");

    expect(ocServer).toHaveBeenCalledWith("C:\\worktree", "/session/ses_2", {
      method: "PATCH",
      body: {
        permission: [{ permission: "task", pattern: "*", action: "allow" }],
      },
    });
  });

  it("URL-encodes the session id", async () => {
    await setSessionTaskPermission("C:\\worktree", "ses/weird id", "deny");

    const [, path] = ocServer.mock.calls[0] ?? [];
    expect(path).toBe("/session/ses%2Fweird%20id");
  });

  it("rejects an empty session id without calling OpenCode", async () => {
    await expect(
      setSessionTaskPermission("C:\\worktree", "   ", "deny"),
    ).rejects.toMatchObject({ status: 400 });
    expect(ocServer).not.toHaveBeenCalled();
  });

  it("applies reviewer denies in one session-scoped PATCH", async () => {
    await applyWorkflowSessionPermissions("C:\\worktree", "reviewer", {
      write: false,
      subagent: false,
      browser: false,
    });

    expect(ocServer).toHaveBeenCalledWith("C:\\worktree", "/session/reviewer", {
      method: "PATCH",
      body: {
        permission: [
          { permission: "edit", pattern: "*", action: "deny" },
          { permission: "write", pattern: "*", action: "deny" },
          { permission: "patch", pattern: "*", action: "deny" },
          { permission: "git", pattern: "*", action: "deny" },
          { permission: "bash", pattern: "*", action: "deny" },
          { permission: "shell", pattern: "*", action: "deny" },
          { permission: "terminal", pattern: "*", action: "deny" },
          { permission: "task", pattern: "*", action: "deny" },
          { permission: "skill", pattern: "*", action: "deny" },
          { permission: "browser_*", pattern: "*", action: "deny" },
        ],
      },
    });
  });

  it("does not issue a no-op PATCH when all capabilities are allowed", async () => {
    await applyWorkflowSessionPermissions("C:\\worktree", "implementer", {
      write: true,
      subagent: true,
      browser: true,
    });
    expect(ocServer).not.toHaveBeenCalled();
  });
});
