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

import { setSessionEditPermission } from "./opencode-access-mode";

describe("setSessionEditPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ocServer.mockResolvedValue(undefined);
  });

  // Regression: 確認する used to be client-only, so OpenCode's default
  // `{"*": "allow"}` let apply_patch / edit / write run with no approval card.
  it("PATCHes an ask rule for the edit permission in 確認する", async () => {
    await setSessionEditPermission("C:\\worktree", "ses_1", "ask");

    expect(ocServer).toHaveBeenCalledTimes(1);
    expect(ocServer).toHaveBeenCalledWith("C:\\worktree", "/session/ses_1", {
      method: "PATCH",
      body: {
        permission: [{ permission: "edit", pattern: "*", action: "ask" }],
      },
    });
  });

  it("PATCHes an allow rule in フルアクセス so a later toggle wins by last-match", async () => {
    await setSessionEditPermission("C:\\worktree", "ses_2", "full");

    expect(ocServer).toHaveBeenCalledWith("C:\\worktree", "/session/ses_2", {
      method: "PATCH",
      body: {
        permission: [{ permission: "edit", pattern: "*", action: "allow" }],
      },
    });
  });

  it("never touches bash so the user's own permission.bash config survives", async () => {
    await setSessionEditPermission("C:\\worktree", "ses_3", "ask");

    const [, , init] = ocServer.mock.calls[0] ?? [];
    const rules = (init as { body: { permission: { permission: string }[] } })
      .body.permission;
    expect(rules.map((r) => r.permission)).toEqual(["edit"]);
  });

  it("URL-encodes the session id", async () => {
    await setSessionEditPermission("C:\\worktree", "ses/weird id", "ask");

    const [, path] = ocServer.mock.calls[0] ?? [];
    expect(path).toBe("/session/ses%2Fweird%20id");
  });

  it("rejects an empty session id without calling OpenCode", async () => {
    await expect(
      setSessionEditPermission("C:\\worktree", "   ", "ask"),
    ).rejects.toMatchObject({ status: 400 });
    expect(ocServer).not.toHaveBeenCalled();
  });
});
