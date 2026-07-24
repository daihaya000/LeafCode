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

import { setSessionTaskPermission } from "./opencode-task-permission";

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
});
