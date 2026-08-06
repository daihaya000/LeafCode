import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveHostControlUrl } = vi.hoisted(() => ({
  resolveHostControlUrl: vi.fn(() => "http://127.0.0.1:18765"),
}));

vi.mock("@/lib/host-control", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/host-control")>();
  return { ...actual, resolveHostControlUrl };
});

import { GET } from "./route";

type Body = { local: boolean; hasUsers: boolean; loginRequired: boolean };

function request(headers: Record<string, string>) {
  return new NextRequest("http://127.0.0.1:3000/api/auth/session", { headers });
}

function usersResponse(usernames: string[]) {
  return new Response(
    JSON.stringify({
      users: usernames.map((username) => ({ username, updatedAt: "now" })),
    }),
    { status: 200 },
  );
}

describe("GET /api/auth/session", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveHostControlUrl.mockReturnValue("http://127.0.0.1:18765");
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("does not require login for a direct loopback caller", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(usersResponse(["alice"])) as unknown as typeof fetch;

    const res = await GET(request({ host: "127.0.0.1:3000" }));
    const body = (await res.json()) as Body;
    expect(body.local).toBe(true);
    expect(body.hasUsers).toBe(true);
    expect(body.loginRequired).toBe(false);
  });

  it("treats localhost and ::1 as loopback", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(usersResponse(["alice"])) as unknown as typeof fetch;

    for (const host of ["localhost:3000", "[::1]:3000"]) {
      const body = (await (await GET(request({ host }))).json()) as Body;
      expect(body.loginRequired).toBe(false);
    }
  });

  it("requires login for a LAN caller once a user exists", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(usersResponse(["alice"])) as unknown as typeof fetch;

    const res = await GET(request({ host: "192.168.1.50:3000" }));
    const body = (await res.json()) as Body;
    expect(body.local).toBe(false);
    expect(body.loginRequired).toBe(true);
  });

  it("does not require login for a LAN caller while no users exist", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(usersResponse([])) as unknown as typeof fetch;

    const res = await GET(request({ host: "192.168.1.50:3000" }));
    const body = (await res.json()) as Body;
    expect(body.hasUsers).toBe(false);
    expect(body.loginRequired).toBe(false);
  });

  it("does not trust a loopback Host header forwarded for a LAN client", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(usersResponse(["alice"])) as unknown as typeof fetch;

    // Caddy rewriting Host to loopback must not let a phone skip the gate.
    const res = await GET(
      request({ host: "127.0.0.1:3000", "x-forwarded-for": "192.168.1.50" }),
    );
    const body = (await res.json()) as Body;
    expect(body.local).toBe(false);
    expect(body.loginRequired).toBe(true);
  });

  it("trusts a same-machine proxy hop that is itself loopback", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(usersResponse(["alice"])) as unknown as typeof fetch;

    const res = await GET(
      request({ host: "localhost:8443", "x-forwarded-for": "127.0.0.1" }),
    );
    const body = (await res.json()) as Body;
    expect(body.local).toBe(true);
    expect(body.loginRequired).toBe(false);
  });

  it("fails closed for remote callers when the host is unreachable", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const res = await GET(request({ host: "192.168.1.50:3000" }));
    const body = (await res.json()) as Body;
    expect(body.hasUsers).toBe(true);
    expect(body.loginRequired).toBe(true);
  });

  it("still lets the host machine in when the control plane is unreachable", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const res = await GET(request({ host: "127.0.0.1:3000" }));
    const body = (await res.json()) as Body;
    expect(body.loginRequired).toBe(false);
  });

  it("fails closed for remote callers when the host returns an error status", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 500 })) as unknown as typeof fetch;

    const res = await GET(request({ host: "192.168.1.50:3000" }));
    const body = (await res.json()) as Body;
    expect(body.loginRequired).toBe(true);
  });
});
