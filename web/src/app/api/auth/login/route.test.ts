import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveHostControlUrl } = vi.hoisted(() => ({
  resolveHostControlUrl: vi.fn(() => "http://127.0.0.1:18765"),
}));

vi.mock("@/lib/host-control", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/host-control")>();
  return { ...actual, resolveHostControlUrl };
});

import { POST } from "./route";

function req(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://127.0.0.1:3000/api/auth/login", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function hostOk() {
  return new Response(JSON.stringify({ ok: true, username: "alice" }), {
    status: 200,
    headers: { "set-cookie": "webui_session=tok; Path=/; HttpOnly" },
  });
}

describe("POST /api/auth/login", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveHostControlUrl.mockReturnValue("http://127.0.0.1:18765");
    global.fetch = vi.fn().mockResolvedValue(hostOk()) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("is reachable without a session (it is how you get one)", async () => {
    const res = await POST(req({ username: "alice", password: "secret" }));
    expect(res.status).toBe(200);
  });

  it("rejects a body missing credentials without calling the host", async () => {
    const res = await POST(req({ username: "alice" }));
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards the caller's address so the host can audit and rate limit it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(hostOk());
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(
      req({ username: "alice", password: "secret" }, { "x-forwarded-for": "192.168.0.5" }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-ocw-client-ip"]).toBe(
      "192.168.0.5",
    );
  });

  it("forwards the proxy-appended hop, not a client-supplied one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(hostOk());
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(
      req(
        { username: "alice", password: "secret" },
        { "x-forwarded-for": "1.2.3.4, 192.168.0.5" },
      ),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // Trusting the leftmost entry would let a client mint a new address per
    // request and walk through the per-IP limit.
    expect((init.headers as Record<string, string>)["x-ocw-client-ip"]).toBe(
      "192.168.0.5",
    );
  });

  it("omits the address header when there is no proxy in front", async () => {
    const fetchMock = vi.fn().mockResolvedValue(hostOk());
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(req({ username: "alice", password: "secret" }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // "unknown" must stay distinguishable from a real address.
    expect((init.headers as Record<string, string>)["x-ocw-client-ip"]).toBeUndefined();
  });

  it("passes the host's Set-Cookie back to the browser", async () => {
    const res = await POST(req({ username: "alice", password: "secret" }));
    expect(res.headers.get("set-cookie")).toContain("webui_session=");
  });

  it("forwards a trusted-device approval request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(hostOk());
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(req({ username: "alice", password: "secret", trustDevice: true }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ trustDevice: true });
  });

  it("maps a host rejection to 401 without leaking the reason", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "invalid credentials" }), {
        status: 401,
      }),
    ) as unknown as typeof fetch;

    const res = await POST(req({ username: "alice", password: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("returns 502 when the host control plane is unreachable", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const res = await POST(req({ username: "alice", password: "secret" }));
    expect(res.status).toBe(502);
  });
});
