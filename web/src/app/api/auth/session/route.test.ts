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

type Body = {
  local: boolean;
  hasUsers: boolean;
  windowsAuth: boolean;
  canAuthenticate: boolean;
  loginRequired: boolean;
};

function request(headers: Record<string, string>) {
  return new NextRequest("http://127.0.0.1:3000/api/auth/session", { headers });
}

function configResponse({ hasUsers = false, windowsAuth = false } = {}) {
  return new Response(
    JSON.stringify({ hasUsers, windowsAuth, windowsAuthSupported: true }),
    { status: 200 },
  );
}

/** Shorthand for the common "one local user exists" host state. */
function usersResponse(usernames: string[]) {
  return configResponse({ hasUsers: usernames.length > 0 });
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

  it("reads /auth/config, not the username list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(configResponse({ hasUsers: true }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await GET(request({ host: "127.0.0.1:3000" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18765/auth/config",
      expect.anything(),
    );
  });

  it("requires login for a LAN caller when only Windows auth is enabled", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        configResponse({ hasUsers: false, windowsAuth: true }),
      ) as unknown as typeof fetch;

    const res = await GET(request({ host: "192.168.1.50:3000" }));
    const body = (await res.json()) as Body;
    expect(body.hasUsers).toBe(false);
    expect(body.windowsAuth).toBe(true);
    expect(body.canAuthenticate).toBe(true);
    expect(body.loginRequired).toBe(true);
  });

  it("still skips the gate on the host machine when Windows auth is enabled", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        configResponse({ hasUsers: true, windowsAuth: true }),
      ) as unknown as typeof fetch;

    const res = await GET(request({ host: "127.0.0.1:3000" }));
    const body = (await res.json()) as Body;
    expect(body.loginRequired).toBe(false);
  });

  it("reports authenticated=false and no username without a cookie", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(configResponse({ hasUsers: true })) as unknown as typeof fetch;

    const body = (await (
      await GET(request({ host: "192.168.1.50:3000" }))
    ).json()) as Body & { authenticated: boolean; username: string | null };
    expect(body.authenticated).toBe(false);
    expect(body.username).toBeNull();
  });

  it("reports the verified username when the cookie checks out", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith("/auth/verify")) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, username: "alice" }), { status: 200 }),
        );
      }
      return Promise.resolve(configResponse({ hasUsers: true }));
    }) as unknown as typeof fetch;

    const body = (await (
      await GET(
        request({ host: "192.168.1.50:3000", cookie: "webui_session=tok" }),
      )
    ).json()) as Body & { authenticated: boolean; username: string | null };
    expect(body.authenticated).toBe(true);
    expect(body.username).toBe("alice");
    // The gate still applies in principle; the client uses `authenticated` to pass.
    expect(body.loginRequired).toBe(true);
  });

  it("reports authenticated=false when the host rejects the cookie", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith("/auth/verify")) {
        return Promise.resolve(new Response("{}", { status: 401 }));
      }
      return Promise.resolve(configResponse({ hasUsers: true }));
    }) as unknown as typeof fetch;

    const body = (await (
      await GET(
        request({ host: "192.168.1.50:3000", cookie: "webui_session=stale" }),
      )
    ).json()) as Body & { authenticated: boolean };
    expect(body.authenticated).toBe(false);
  });

  it("reports canAuthenticate false when nothing can authenticate", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        configResponse({ hasUsers: false, windowsAuth: false }),
      ) as unknown as typeof fetch;

    const res = await GET(request({ host: "192.168.1.50:3000" }));
    const body = (await res.json()) as Body;
    expect(body.canAuthenticate).toBe(false);
    expect(body.loginRequired).toBe(false);
  });
});
