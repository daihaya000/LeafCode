import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveHostControlUrl } = vi.hoisted(() => ({
  resolveHostControlUrl: vi.fn(() => "http://127.0.0.1:18765"),
}));

vi.mock("@/lib/host-control", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/host-control")>();
  return { ...actual, resolveHostControlUrl };
});

import { sessionTokenFromCookieHeader, verifySession } from "./session";

describe("sessionTokenFromCookieHeader", () => {
  it("extracts the token", () => {
    expect(sessionTokenFromCookieHeader("webui_session=abc.def")).toBe("abc.def");
  });

  it("finds the cookie among others", () => {
    expect(
      sessionTokenFromCookieHeader("theme=dark; webui_session=abc.def; other=1"),
    ).toBe("abc.def");
  });

  it("percent-decodes the value", () => {
    expect(sessionTokenFromCookieHeader("webui_session=a%2Eb")).toBe("a.b");
  });

  it("returns null when absent, empty or malformed", () => {
    expect(sessionTokenFromCookieHeader(null)).toBeNull();
    expect(sessionTokenFromCookieHeader(undefined)).toBeNull();
    expect(sessionTokenFromCookieHeader("")).toBeNull();
    expect(sessionTokenFromCookieHeader("theme=dark")).toBeNull();
    expect(sessionTokenFromCookieHeader("webui_session=")).toBeNull();
    // An invalid escape cannot be a token we issued.
    expect(sessionTokenFromCookieHeader("webui_session=%E0%A4%A")).toBeNull();
  });

  it("does not match a cookie whose name merely ends with ours", () => {
    expect(sessionTokenFromCookieHeader("not_webui_session=abc")).toBeNull();
    expect(sessionTokenFromCookieHeader("xwebui_session=abc")).toBeNull();
  });
});

describe("verifySession", () => {
  const originalFetch = global.fetch;

  function req(headers: Record<string, string> = {}) {
    return new Request("http://127.0.0.1:3000/api/anything", { headers });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resolveHostControlUrl.mockReturnValue("http://127.0.0.1:18765");
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns the username for a token the host accepts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, username: "alice" }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await verifySession(req({ cookie: "webui_session=tok" }));
    expect(result).toEqual({ username: "alice" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:18765/auth/verify");
    expect(JSON.parse(String(init.body))).toEqual({
      token: "tok",
      trustedDeviceToken: null,
    });
  });

  it("does not call the host when there is no cookie", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await verifySession(req())).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the host rejects the token", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), { status: 401 }),
    ) as unknown as typeof fetch;

    expect(await verifySession(req({ cookie: "webui_session=bad" }))).toBeNull();
  });

  it("returns null when the host answers 200 but not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, username: "alice" }), { status: 200 }),
    ) as unknown as typeof fetch;

    expect(await verifySession(req({ cookie: "webui_session=x" }))).toBeNull();
  });

  it("returns null when the host omits the username", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof fetch;

    expect(await verifySession(req({ cookie: "webui_session=x" }))).toBeNull();
  });

  it("fails closed when the host is unreachable", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    expect(await verifySession(req({ cookie: "webui_session=x" }))).toBeNull();
  });

  it("fails closed on a non-JSON response", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response("<html>", { status: 200 })) as unknown as typeof fetch;

    expect(await verifySession(req({ cookie: "webui_session=x" }))).toBeNull();
  });
});
