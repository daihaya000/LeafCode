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
});
