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
  setSessionEditPermission,
  shouldSyncAccessCeilingForSessionCreated,
} from "./opencode-access-mode";

describe("setSessionEditPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ocServer.mockResolvedValue(undefined);
  });

  // Regression: 確認する used to be client-only, so OpenCode's default
  // `{"*": "allow"}` let apply_patch / edit / write run with no approval card.
  it("PATCHes an ask rule for the edit permission in 確認する", async () => {
    await setSessionEditPermission("C:\\worktree", "ses_1", "ask");

    expect(ocServer).toHaveBeenCalledWith("C:\\worktree", "/session/ses_1", {
      method: "PATCH",
      body: {
        permission: [{ permission: "edit", pattern: "*", action: "ask" }],
      },
    });
    expect(ocServer).toHaveBeenCalledWith(
      "C:\\worktree",
      "/session/ses_1/children",
    );
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

  it("applies the same edit ceiling to direct child sessions", async () => {
    ocServer.mockImplementation(async (_directory: string, path: string) => {
      if (String(path).endsWith("/children")) {
        if (String(path).includes("ses_parent")) {
          return [{ id: "ses_child" }, { id: "ses_other" }];
        }
        return [];
      }
      return undefined;
    });

    await setSessionEditPermission("C:\\worktree", "ses_parent", "ask");

    const patched = ocServer.mock.calls
      .filter(([, , init]) => init && typeof init === "object")
      .map(([, path]) => path);
    expect(patched).toEqual(
      expect.arrayContaining([
        "/session/ses_parent",
        "/session/ses_child",
        "/session/ses_other",
      ]),
    );
    for (const [, path, init] of ocServer.mock.calls) {
      if (!init || typeof init !== "object") continue;
      expect(init).toEqual({
        method: "PATCH",
        body: {
          permission: [{ permission: "edit", pattern: "*", action: "ask" }],
        },
      });
      expect(String(path)).not.toMatch(/\/children$/);
    }
  });

  it("recursively applies the ceiling to nested grandchild sessions", async () => {
    ocServer.mockImplementation(async (_directory: string, path: string) => {
      const p = String(path);
      if (p.endsWith("/children")) {
        if (p.includes("ses_parent") && !p.includes("ses_child")) {
          return [{ id: "ses_child" }];
        }
        if (p.includes("ses_child")) {
          return [{ id: "ses_grand" }];
        }
        return [];
      }
      return undefined;
    });

    await setSessionEditPermission("C:\\worktree", "ses_parent", "ask");

    const patched = ocServer.mock.calls
      .filter(([, , init]) => init && typeof init === "object")
      .map(([, path]) => path);
    expect(patched).toEqual(
      expect.arrayContaining([
        "/session/ses_parent",
        "/session/ses_child",
        "/session/ses_grand",
      ]),
    );
  });

  it("still succeeds when listing children fails", async () => {
    ocServer.mockImplementation(async (_directory: string, path: string) => {
      if (String(path).endsWith("/children")) {
        throw new Error("children unavailable");
      }
      return undefined;
    });

    await expect(
      setSessionEditPermission("C:\\worktree", "ses_parent", "full"),
    ).resolves.toBeUndefined();
    expect(ocServer).toHaveBeenCalledWith("C:\\worktree", "/session/ses_parent", {
      method: "PATCH",
      body: {
        permission: [{ permission: "edit", pattern: "*", action: "allow" }],
      },
    });
  });

  it("PATCHes ensureSessionIds even when /children returns empty", async () => {
    ocServer.mockImplementation(async (_directory: string, path: string) => {
      if (String(path).endsWith("/children")) return [];
      return undefined;
    });

    await setSessionEditPermission("C:\\worktree", "ses_parent", "ask", [
      "ses_child",
    ]);

    const patched = ocServer.mock.calls
      .filter(([, , init]) => init && typeof init === "object")
      .map(([, path]) => path);
    expect(patched).toEqual(
      expect.arrayContaining(["/session/ses_parent", "/session/ses_child"]),
    );
  });

  it("PATCHes ensureSessionIds before waiting on /children BFS", async () => {
    const order: string[] = [];
    ocServer.mockImplementation(async (_directory: string, path: string, init?: unknown) => {
      if (String(path).endsWith("/children")) {
        order.push("children");
        await new Promise((resolve) => setTimeout(resolve, 30));
        return [{ id: "ses_listed" }];
      }
      if (init && typeof init === "object") {
        order.push(String(path));
      }
      return undefined;
    });

    await setSessionEditPermission("C:\\worktree", "ses_parent", "ask", [
      "ses_child",
    ]);

    const childIdx = order.indexOf("/session/ses_child");
    const childrenIdx = order.indexOf("children");
    const listedIdx = order.indexOf("/session/ses_listed");
    expect(childIdx).toBeGreaterThanOrEqual(0);
    expect(childrenIdx).toBeGreaterThanOrEqual(0);
    expect(childIdx).toBeLessThan(childrenIdx);
    expect(listedIdx).toBeGreaterThan(childrenIdx);
  });
});

describe("shouldSyncAccessCeilingForSessionCreated", () => {
  it("tracks a direct child of the root session", () => {
    expect(
      shouldSyncAccessCeilingForSessionCreated({
        rootSessionId: "ses_root",
        parentID: "ses_root",
        sessionID: "ses_child",
        knownDescendants: new Set(),
      }),
    ).toEqual({ track: true, sessionID: "ses_child" });
  });

  it("tracks a grandchild when the parent was already known", () => {
    expect(
      shouldSyncAccessCeilingForSessionCreated({
        rootSessionId: "ses_root",
        parentID: "ses_child",
        sessionID: "ses_grand",
        knownDescendants: new Set(["ses_child"]),
      }),
    ).toEqual({ track: true, sessionID: "ses_grand" });
  });

  it("ignores unrelated sessions", () => {
    expect(
      shouldSyncAccessCeilingForSessionCreated({
        rootSessionId: "ses_root",
        parentID: "ses_other",
        sessionID: "ses_x",
        knownDescendants: new Set(),
      }),
    ).toEqual({ track: false });
  });
});
