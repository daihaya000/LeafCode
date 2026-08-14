import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveHostControlUrl } = vi.hoisted(() => ({
  resolveHostControlUrl: vi.fn(() => "http://127.0.0.1:18765"),
}));

vi.mock("@/lib/host-control", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/host-control")>();
  return { ...actual, resolveHostControlUrl };
});

import { GET, POST } from "./route";

const LOCAL = "127.0.0.1:3000";
const REMOTE = "192.168.1.50:3000";

function req(host: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  return new NextRequest("http://127.0.0.1:3000/api/host/browser-config", {
    method: body === undefined ? "GET" : "POST",
    headers: { host, "content-type": "application/json", ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("/api/host/browser-config", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveHostControlUrl.mockReturnValue("http://127.0.0.1:18765");
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, autoOpenBrowser: false }), { status: 200 }),
      ) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects GET from a LAN caller", async () => {
    const res = await GET(req(REMOTE));
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects POST from a LAN caller", async () => {
    const res = await POST(req(REMOTE, { autoOpenBrowser: true }));
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("allows GET from the host machine", async () => {
    const res = await GET(req(LOCAL));
    expect(res.status).toBe(200);
  });

  it("allows POST from the host machine", async () => {
    const res = await POST(req(LOCAL, { autoOpenBrowser: true }));
    expect(res.status).toBe(200);
  });

  it("marks a loopback caller as local so the host treats it as admin", async () => {
    await POST(req(LOCAL, { autoOpenBrowser: true }));
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>)["x-ocw-local-request"]).toBe("1");
  });

  it("forwards the browser's session cookie to the host", async () => {
    await POST(
      req(LOCAL, { autoOpenBrowser: true }, { cookie: "webui_session=tok" }),
    );
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>).cookie).toBe("webui_session=tok");
  });

  it("rejects a non-boolean flag", async () => {
    const res = await POST(req(LOCAL, { autoOpenBrowser: "yes" }));
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("propagates a host rejection", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: "admin session required" }), {
          status: 403,
        }),
      ) as unknown as typeof fetch;

    const res = await POST(req(LOCAL, { autoOpenBrowser: true }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("admin session required");
  });
});
