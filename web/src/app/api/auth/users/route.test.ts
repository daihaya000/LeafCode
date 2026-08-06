import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveHostControlUrl } = vi.hoisted(() => ({
  resolveHostControlUrl: vi.fn(() => "http://127.0.0.1:18765"),
}));

vi.mock("@/lib/host-control", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/host-control")>();
  return { ...actual, resolveHostControlUrl };
});

import { DELETE, GET, POST } from "./route";

const LOCAL = "127.0.0.1:3000";
const REMOTE = "192.168.1.50:3000";

function req(host: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  return new NextRequest("http://127.0.0.1:3000/api/auth/users", {
    method: body === undefined ? "GET" : "POST",
    headers: { host, "content-type": "application/json", ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("/api/auth/users host-only guard", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveHostControlUrl.mockReturnValue("http://127.0.0.1:18765");
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, users: [] }), { status: 200 }),
      ) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects GET from a LAN caller without touching the host", async () => {
    const res = await GET(req(REMOTE));
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects POST from a LAN caller so it cannot create an account", async () => {
    const res = await POST(req(REMOTE, { username: "mallory", password: "pwned" }));
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects DELETE from a LAN caller so it cannot remove accounts", async () => {
    const res = await DELETE(req(REMOTE, { username: "alice" }));
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a spoofed loopback Host when X-Forwarded-For is a LAN client", async () => {
    const request = new NextRequest("http://127.0.0.1:3000/api/auth/users", {
      headers: { host: LOCAL, "x-forwarded-for": "192.168.1.50" },
    });
    const res = await GET(request);
    expect(res.status).toBe(403);
  });

  it("allows GET from the host machine", async () => {
    const res = await GET(req(LOCAL));
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:18765/users",
      expect.anything(),
    );
  });

  it("allows POST from the host machine", async () => {
    const res = await POST(req(LOCAL, { username: "alice", password: "secret" }));
    expect(res.status).toBe(200);
  });

  it("still validates the body for local callers", async () => {
    const res = await POST(req(LOCAL, { username: "alice" }));
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards the browser's session cookie to the host on POST", async () => {
    // The host now requires an admin session to create a user; without
    // forwarding the cookie, every POST would 403 from the host regardless of
    // who is asking.
    await POST(
      req(LOCAL, { username: "alice", password: "secret" }, { cookie: "webui_session=tok" }),
    );
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>).cookie).toBe("webui_session=tok");
  });

  it("forwards the browser's session cookie to the host on DELETE", async () => {
    await DELETE(req(LOCAL, { username: "alice" }, { cookie: "webui_session=tok" }));
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>).cookie).toBe("webui_session=tok");
  });

  it("omits the cookie header entirely when the browser sent none", async () => {
    await POST(req(LOCAL, { username: "alice", password: "secret" }));
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>).cookie).toBeUndefined();
  });
});
