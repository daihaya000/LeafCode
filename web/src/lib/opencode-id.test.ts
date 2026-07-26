import { describe, expect, it } from "vitest";
import {
  assertSafeOpenCodePath,
  assertSafeOpenCodeSessionId,
  isSafeOpenCodeSessionId,
  openCodeSessionPath,
  resolvedOpenCodePathname,
} from "./opencode-id";
import { isBlockedOpencodeWrite } from "./opencode";

describe("isSafeOpenCodeSessionId", () => {
  it("accepts ordinary engine ids", () => {
    expect(isSafeOpenCodeSessionId("ses_abc123")).toBe(true);
    expect(isSafeOpenCodeSessionId("session-1")).toBe(true);
  });

  it("rejects traversal and separators", () => {
    expect(isSafeOpenCodeSessionId("../../auth/openai")).toBe(false);
    expect(isSafeOpenCodeSessionId("a/b")).toBe(false);
    expect(isSafeOpenCodeSessionId("")).toBe(false);
    expect(isSafeOpenCodeSessionId("../x")).toBe(false);
  });
});

describe("assertSafeOpenCodePath", () => {
  it("allows normal session routes", () => {
    expect(() => assertSafeOpenCodePath("/session/ses_1")).not.toThrow();
    expect(() =>
      assertSafeOpenCodePath("/session/ses_1/message"),
    ).not.toThrow();
  });

  it("rejects path traversal segments", () => {
    expect(() =>
      assertSafeOpenCodePath("/session/../../auth/openai"),
    ).toThrow(/invalid OpenCode path/);
    expect(() => assertSafeOpenCodePath("/session/./x")).toThrow();
  });

  it("rejects percent-encoded traversal", () => {
    expect(() =>
      assertSafeOpenCodePath("/session/%2e%2e/%2e%2e/auth/openai"),
    ).toThrow(/invalid OpenCode path/);
    expect(() =>
      assertSafeOpenCodePath("/session/%252e%252e/auth/openai"),
    ).toThrow(/invalid OpenCode path/);
  });
});

describe("resolvedOpenCodePathname", () => {
  it("returns the resolved pathname for safe paths", () => {
    expect(
      resolvedOpenCodePathname("/session/ses_1", "http://127.0.0.1:4096"),
    ).toBe("/session/ses_1");
  });
});

describe("openCodeSessionPath", () => {
  it("encodes a safe id", () => {
    expect(openCodeSessionPath("ses_1")).toBe("/session/ses_1");
    expect(openCodeSessionPath("ses_1", "message")).toBe(
      "/session/ses_1/message",
    );
  });

  it("rejects unsafe ids before building", () => {
    expect(() => openCodeSessionPath("../../auth/x")).toThrow();
  });
});

describe("assertSafeOpenCodeSessionId", () => {
  it("throws on unsafe ids", () => {
    expect(() => assertSafeOpenCodeSessionId("../../auth/x")).toThrow();
  });
});

describe("isBlockedOpencodeWrite", () => {
  it("blocks PATCH /config and /global/config", () => {
    expect(isBlockedOpencodeWrite("PATCH", "/config")).toBe(true);
    expect(isBlockedOpencodeWrite("PATCH", "/global/config")).toBe(true);
    expect(isBlockedOpencodeWrite("GET", "/global/config")).toBe(false);
  });

  it("blocks auth DELETE on resolved pathnames", () => {
    expect(isBlockedOpencodeWrite("DELETE", "/auth/openai")).toBe(true);
  });

  it("blocks provider and integration OAuth writes", () => {
    expect(
      isBlockedOpencodeWrite("POST", "/provider/openai/oauth/authorize"),
    ).toBe(true);
    expect(
      isBlockedOpencodeWrite("POST", "/provider/openai/oauth/callback"),
    ).toBe(true);
    expect(
      isBlockedOpencodeWrite(
        "POST",
        "/api/integration/github/connect/oauth",
      ),
    ).toBe(true);
    expect(
      isBlockedOpencodeWrite("GET", "/provider/openai/oauth/authorize"),
    ).toBe(false);
  });

  it("blocks PTY create/update/delete/connect-token", () => {
    expect(isBlockedOpencodeWrite("POST", "/pty")).toBe(true);
    expect(isBlockedOpencodeWrite("PUT", "/pty/abc123")).toBe(true);
    expect(isBlockedOpencodeWrite("DELETE", "/pty/abc123")).toBe(true);
    expect(isBlockedOpencodeWrite("POST", "/pty/abc123/connect-token")).toBe(true);
  });

  it("blocks /api/pty create/update/delete/connect-token", () => {
    expect(isBlockedOpencodeWrite("POST", "/api/pty")).toBe(true);
    expect(isBlockedOpencodeWrite("PUT", "/api/pty/abc123")).toBe(true);
    expect(isBlockedOpencodeWrite("DELETE", "/api/pty/abc123")).toBe(true);
    expect(isBlockedOpencodeWrite("POST", "/api/pty/abc123/connect-token")).toBe(true);
  });

  it("blocks global/instance dispose", () => {
    expect(isBlockedOpencodeWrite("POST", "/global/dispose")).toBe(true);
    expect(isBlockedOpencodeWrite("POST", "/instance/dispose")).toBe(true);
  });

  it("blocks vcs apply", () => {
    expect(isBlockedOpencodeWrite("POST", "/vcs/apply")).toBe(true);
  });

  it("blocks experimental worktree/workspace mutating methods", () => {
    expect(isBlockedOpencodeWrite("POST", "/experimental/worktree")).toBe(true);
    expect(isBlockedOpencodeWrite("DELETE", "/experimental/worktree")).toBe(true);
    expect(isBlockedOpencodeWrite("POST", "/experimental/worktree/reset")).toBe(true);
    expect(isBlockedOpencodeWrite("POST", "/experimental/workspace")).toBe(true);
    expect(isBlockedOpencodeWrite("DELETE", "/experimental/workspace/ws1")).toBe(true);
    expect(isBlockedOpencodeWrite("POST", "/experimental/workspace/sync-list")).toBe(true);
    expect(isBlockedOpencodeWrite("POST", "/experimental/workspace/warp")).toBe(true);
  });

  it("blocks experimental control-plane move-session and console switch", () => {
    expect(isBlockedOpencodeWrite("POST", "/experimental/control-plane/move-session")).toBe(true);
    expect(isBlockedOpencodeWrite("POST", "/experimental/console/switch")).toBe(true);
  });

  it("blocks DELETE mcp auth", () => {
    expect(isBlockedOpencodeWrite("DELETE", "/mcp/github/auth")).toBe(true);
  });

  it("blocks global upgrade and sync steal", () => {
    expect(isBlockedOpencodeWrite("POST", "/global/upgrade")).toBe(true);
    expect(isBlockedOpencodeWrite("POST", "/sync/steal")).toBe(true);
  });

  it("blocks project git init and project update", () => {
    expect(isBlockedOpencodeWrite("POST", "/project/git/init")).toBe(true);
    expect(isBlockedOpencodeWrite("PATCH", "/project/proj123")).toBe(true);
    expect(isBlockedOpencodeWrite("GET", "/project/proj123")).toBe(false);
  });

  it("blocks session share create/revoke", () => {
    expect(isBlockedOpencodeWrite("POST", "/session/ses_abc/share")).toBe(true);
    expect(isBlockedOpencodeWrite("DELETE", "/session/ses_abc/share")).toBe(true);
    expect(isBlockedOpencodeWrite("GET", "/session/ses_abc/share")).toBe(false);
  });

  it("blocks experimental session background", () => {
    expect(isBlockedOpencodeWrite("POST", "/experimental/session/ses_abc/background")).toBe(true);
  });

  it("blocks TUI remote control", () => {
    expect(isBlockedOpencodeWrite("POST", "/tui/append-prompt")).toBe(true);
    expect(isBlockedOpencodeWrite("POST", "/tui/execute-command")).toBe(true);
    expect(isBlockedOpencodeWrite("POST", "/tui/control/response")).toBe(true);
    expect(isBlockedOpencodeWrite("GET", "/tui/open-help")).toBe(false);
  });

  it("blocks saved permission removal", () => {
    expect(isBlockedOpencodeWrite("DELETE", "/permission/saved/perm1")).toBe(true);
    expect(isBlockedOpencodeWrite("DELETE", "/api/permission/saved/perm1")).toBe(true);
    expect(isBlockedOpencodeWrite("GET", "/api/permission/saved")).toBe(false);
  });

  it("still allows read-only endpoints", () => {
    expect(isBlockedOpencodeWrite("GET", "/pty")).toBe(false);
    expect(isBlockedOpencodeWrite("GET", "/api/pty")).toBe(false);
    expect(isBlockedOpencodeWrite("GET", "/api/pty/abc123")).toBe(false);
    expect(isBlockedOpencodeWrite("GET", "/experimental/worktree")).toBe(false);
    expect(isBlockedOpencodeWrite("GET", "/experimental/workspace")).toBe(false);
    expect(isBlockedOpencodeWrite("GET", "/global/config")).toBe(false);
    expect(isBlockedOpencodeWrite("GET", "/provider")).toBe(false);
  });
});
