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
  return new NextRequest("http://127.0.0.1:3000/api/auth/config", {
    method: body === undefined ? "GET" : "POST",
    headers: { host, "content-type": "application/json", ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function hostConfig({ windowsAuth = false, windowsAuthSupported = true, hasUsers = false } = {}) {
  return new Response(
    JSON.stringify({ ok: true, windowsAuth, windowsAuthSupported, hasUsers }),
    { status: 200 },
  );
}

describe("/api/auth/config", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveHostControlUrl.mockReturnValue("http://127.0.0.1:18765");
    global.fetch = vi.fn().mockResolvedValue(hostConfig()) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects GET from a LAN caller", async () => {
    const res = await GET(req(REMOTE));
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects POST from a LAN caller so the toggle cannot be flipped remotely", async () => {
    const res = await POST(req(REMOTE, { windowsAuth: true }));
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns the host config for a local caller", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        hostConfig({ windowsAuth: true, hasUsers: true }),
      ) as unknown as typeof fetch;

    const res = await GET(req(LOCAL));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      windowsAuth: true,
      windowsAuthSupported: true,
      hasUsers: true,
    });
  });

  it("coerces missing host fields to false rather than undefined", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 })) as unknown as typeof fetch;

    const res = await GET(req(LOCAL));
    expect(await res.json()).toEqual({
      windowsAuth: false,
      windowsAuthSupported: false,
      hasUsers: false,
    });
  });

  it("forwards a boolean toggle to the host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(hostConfig({ windowsAuth: true }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await POST(req(LOCAL, { windowsAuth: true }));
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:18765/auth/config");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ windowsAuth: true });
  });

  it("rejects a non-boolean toggle without calling the host", async () => {
    for (const body of [{ windowsAuth: "true" }, { windowsAuth: 1 }, {}]) {
      const res = await POST(req(LOCAL, body));
      expect(res.status).toBe(400);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("propagates a host rejection (e.g. unsupported OS)", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "Windows 認証はこの OS では利用できません" }), {
        status: 400,
      }),
    ) as unknown as typeof fetch;

    const res = await POST(req(LOCAL, { windowsAuth: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("この OS では利用できません");
  });

  it("returns 502 when the host control plane is unreachable", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const res = await GET(req(LOCAL));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("ホストに接続できません");
  });

  it("forwards the browser's session cookie to the host on POST", async () => {
    // The host now requires an admin session to toggle Windows-account login;
    // without forwarding the cookie, POST would always 403 from the host.
    const fetchMock = vi.fn().mockResolvedValue(hostConfig({ windowsAuth: true }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(req(LOCAL, { windowsAuth: true }, { cookie: "webui_session=tok" }));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).cookie).toBe("webui_session=tok");
  });

  it("omits the cookie header entirely when the browser sent none", async () => {
    const fetchMock = vi.fn().mockResolvedValue(hostConfig());
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(req(LOCAL, { windowsAuth: true }));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).cookie).toBeUndefined();
  });
});
