import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifySession } = vi.hoisted(() => ({ verifySession: vi.fn() }));

vi.mock("@/lib/session", () => ({
  verifySession,
  SESSION_COOKIE: "webui_session",
  sessionTokenFromCookieHeader: vi.fn(),
}));

import {
  hostHeaderName,
  isLocalOrPrivateNetworkRequest,
  isLocalHostRequest,
  isLoopbackAddress,
  isPrivateAddress,
  rejectUnlessLocal,
  rejectUnlessLocalOrAuthenticated,
  rejectUnlessLocalOrPrivateNetwork,
} from "./local-request";

beforeEach(() => {
  verifySession.mockReset();
  verifySession.mockResolvedValue(null);
});

describe("isLoopbackAddress", () => {
  it("accepts common loopback forms", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("localhost")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("[::1]")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("rejects LAN and empty values", () => {
    expect(isLoopbackAddress("192.168.0.102")).toBe(false);
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
    expect(isLoopbackAddress("")).toBe(false);
    expect(isLoopbackAddress("example.com")).toBe(false);
  });
});

describe("hostHeaderName", () => {
  it("parses IPv4, hostname, and bracketed IPv6", () => {
    expect(hostHeaderName("127.0.0.1:3000")).toBe("127.0.0.1");
    expect(hostHeaderName("localhost:8443")).toBe("localhost");
    expect(hostHeaderName("[::1]:3000")).toBe("[::1]");
    expect(hostHeaderName("[::1]")).toBe("[::1]");
  });
});

describe("isLocalHostRequest", () => {
  it("rejects LAN Host without proxy headers (not via trusted Caddy)", () => {
    expect(
      isLocalHostRequest(
        new Request("http://192.168.0.102:3000/x", {
          headers: { host: "192.168.0.102:3000" },
        }),
      ),
    ).toBe(false);
  });

  it("rejects a public hostname as Host", () => {
    expect(
      isLocalHostRequest(
        new Request("http://example.com:3000/x", {
          headers: { host: "example.com:3000" },
        }),
      ),
    ).toBe(false);
  });

  it("accepts loopback Host with loopback X-Forwarded-For (Caddy on the same PC)", () => {
    // Browser on the host PC reaches Caddy via a loopback hostname, so the
    // immediate client hop in X-Forwarded-For is loopback. A later hop
    // (10.0.0.1) is ignored — only the first, proxy-adjacent entry matters.
    expect(
      isLocalHostRequest(
        new Request("http://127.0.0.1:3000/x", {
          headers: {
            host: "127.0.0.1:8443",
            "x-forwarded-for": "127.0.0.1, 10.0.0.1",
          },
        }),
      ),
    ).toBe(true);
  });

  it("rejects loopback Host with public X-Forwarded-For", () => {
    expect(
      isLocalHostRequest(
        new Request("http://127.0.0.1:3000/x", {
          headers: {
            host: "localhost:8443",
            "x-forwarded-for": "203.0.113.50",
          },
        }),
      ),
    ).toBe(false);
  });

  it("accepts direct loopback Host without proxy headers", () => {
    expect(
      isLocalHostRequest(
        new Request("http://127.0.0.1:3000/x", {
          headers: { host: "127.0.0.1:3000" },
        }),
      ),
    ).toBe(true);
  });

  it("accepts bracketed IPv6 Host", () => {
    expect(
      isLocalHostRequest(
        new Request("http://[::1]:3000/x", {
          headers: { host: "[::1]:3000" },
        }),
      ),
    ).toBe(true);
  });

  it("rejects LAN Host with loopback X-Forwarded-For (Host not rewritten to loopback)", () => {
    // A non-loopback Host can never be a host-only request, regardless of XFF.
    expect(
      isLocalHostRequest(
        new Request("http://192.168.0.102:8443/x", {
          headers: {
            host: "192.168.0.102:8443",
            "x-forwarded-for": "127.0.0.1",
          },
        }),
      ),
    ).toBe(false);
  });

  it("rejects loopback Host with private X-Forwarded-For (Caddy-proxied LAN client)", () => {
    // Even when Caddy rewrites Host to 127.0.0.1:3000, a LAN/VPN client whose
    // immediate hop is a private IP must not reach host-only APIs without auth.
    // The previous design accepted this; the fail-safe design rejects it.
    expect(
      isLocalHostRequest(
        new Request("http://127.0.0.1:3000/x", {
          headers: {
            host: "127.0.0.1:3000",
            "x-forwarded-for": "192.168.0.102",
          },
        }),
      ),
    ).toBe(false);
  });

  it("rejects a spoofed private X-Forwarded-For with a loopback Host (CSRF spoof regression)", () => {
    // An attacker on the LAN (or anywhere the BFF port is reachable) can send
    // an arbitrary X-Forwarded-For. The fail-safe design must not grant
    // host-only access based on a spoofable private value, even when the Host
    // header is loopback (which Caddy may rewrite for host-only paths).
    expect(
      isLocalHostRequest(
        new Request("http://127.0.0.1:3000/api/browse/folder", {
          headers: {
            host: "127.0.0.1:3000",
            "x-forwarded-for": "10.0.0.99",
          },
        }),
      ),
    ).toBe(false);
  });

  it("rejects a spoofed loopback Host when the real socket is non-loopback (BR-12)", () => {
    // A LAN client connecting directly (LEAFCODE_HOST=0.0.0.0) can forge
    // `Host: 127.0.0.1:3000` with no X-Forwarded-For. The TCP peer address
    // cannot be spoofed, so it must veto the header-based verdict.
    const req = new Request("http://127.0.0.1:3000/x", {
      headers: { host: "127.0.0.1:3000" },
    });
    Object.defineProperty(req, "socket", {
      value: { remoteAddress: "192.168.0.102" },
    });
    expect(isLocalHostRequest(req)).toBe(false);
  });

  it("accepts a loopback Host when the real socket is loopback", () => {
    const req = new Request("http://127.0.0.1:3000/x", {
      headers: { host: "127.0.0.1:3000" },
    });
    Object.defineProperty(req, "socket", {
      value: { remoteAddress: "127.0.0.1" },
    });
    expect(isLocalHostRequest(req)).toBe(true);
  });

  it("accepts an IPv4-mapped loopback socket with a loopback Host", () => {
    const req = new Request("http://127.0.0.1:3000/x", {
      headers: { host: "127.0.0.1:3000" },
    });
    Object.defineProperty(req, "socket", {
      value: { remoteAddress: "::ffff:127.0.0.1" },
    });
    expect(isLocalHostRequest(req)).toBe(true);
  });

  it("still rejects a loopback socket with a LAN X-Forwarded-For (Caddy path)", () => {
    const req = new Request("http://127.0.0.1:3000/x", {
      headers: {
        host: "127.0.0.1:3000",
        "x-forwarded-for": "192.168.0.102",
      },
    });
    Object.defineProperty(req, "socket", {
      value: { remoteAddress: "127.0.0.1" },
    });
    expect(isLocalHostRequest(req)).toBe(false);
  });
});

describe("isPrivateAddress", () => {
  it("accepts private LAN ranges and rejects public hosts", () => {
    expect(isPrivateAddress("192.168.0.102")).toBe(true);
    expect(isPrivateAddress("10.0.0.5")).toBe(true);
    expect(isPrivateAddress("172.16.0.5")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("100.100.10.20")).toBe(true);
    expect(isPrivateAddress("203.0.113.50")).toBe(false);
    expect(isPrivateAddress("example.com")).toBe(false);
  });
});

describe("isLocalOrPrivateNetworkRequest", () => {
  it("accepts direct LAN access for restart from a phone", () => {
    expect(
      isLocalOrPrivateNetworkRequest(
        new Request("http://192.168.0.102:3000/x", {
          headers: { host: "192.168.0.102:3000" },
        }),
      ),
    ).toBe(true);
  });

  it("accepts LAN access through a proxy that preserves the LAN Host", () => {
    expect(
      isLocalOrPrivateNetworkRequest(
        new Request("http://192.168.0.102:8443/x", {
          headers: {
            host: "192.168.0.102:8443",
            "x-forwarded-for": "192.168.0.55",
          },
        }),
      ),
    ).toBe(true);
  });

  it("rejects public hosts for restart", () => {
    expect(
      isLocalOrPrivateNetworkRequest(
        new Request("http://example.com:3000/x", {
          headers: { host: "example.com:3000" },
        }),
      ),
    ).toBe(false);
  });
});

describe("rejectUnlessLocal", () => {
  it("returns 403 for non-local callers", async () => {
    const res = rejectUnlessLocal(
      new Request("http://example.com:3000/x", {
        headers: { host: "example.com:3000" },
      }),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    await expect(res!.json()).resolves.toMatchObject({
      error: expect.stringContaining("host machine"),
    });
  });

  it("returns null for local callers", () => {
    expect(
      rejectUnlessLocal(
        new Request("http://localhost:3000/x", {
          headers: { host: "localhost:3000" },
        }),
      ),
    ).toBeNull();
  });
});

describe("rejectUnlessLocalOrPrivateNetwork", () => {
  it("returns null for LAN callers", async () => {
    await expect(
      rejectUnlessLocalOrPrivateNetwork(
        new Request("http://192.168.0.102:3000/x", {
          headers: { host: "192.168.0.102:3000" },
        }),
      ),
    ).resolves.toBeNull();
  });

  it("returns null for a public host once the session verifies", async () => {
    verifySession.mockResolvedValue({ username: "alice" });
    await expect(
      rejectUnlessLocalOrPrivateNetwork(
        new Request("https://webui.example.com/x", {
          headers: { host: "webui.example.com", cookie: "webui_session=tok" },
        }),
      ),
    ).resolves.toBeNull();
  });

  it("returns 403 for a public host with no session", async () => {
    verifySession.mockResolvedValue(null);
    const res = await rejectUnlessLocalOrPrivateNetwork(
      new Request("https://webui.example.com/x", {
        headers: { host: "webui.example.com" },
      }),
    );
    expect(res?.status).toBe(403);
  });
});

describe("rejectUnlessLocalOrAuthenticated", () => {
  it("returns null for a loopback caller without consulting the session", async () => {
    await expect(
      rejectUnlessLocalOrAuthenticated(
        new Request("http://127.0.0.1:3000/x", {
          headers: { host: "127.0.0.1:3000" },
        }),
      ),
    ).resolves.toBeNull();
    expect(verifySession).not.toHaveBeenCalled();
  });

  it("returns null for a LAN caller holding a verified session", async () => {
    verifySession.mockResolvedValue({ username: "alice" });
    await expect(
      rejectUnlessLocalOrAuthenticated(
        new Request("http://192.168.0.102:3000/x", {
          headers: { host: "192.168.0.102:3000", cookie: "webui_session=tok" },
        }),
      ),
    ).resolves.toBeNull();
  });

  it("returns 403 for a LAN caller with no session", async () => {
    verifySession.mockResolvedValue(null);
    const res = await rejectUnlessLocalOrAuthenticated(
      new Request("http://192.168.0.102:3000/x", {
        headers: { host: "192.168.0.102:3000" },
      }),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    await expect(res!.json()).resolves.toMatchObject({
      error: expect.stringContaining("signed-in session"),
      code: "auth-required",
    });
  });

  it("returns 403 when a spoofed loopback Host carries a LAN X-Forwarded-For and no session", async () => {
    verifySession.mockResolvedValue(null);
    const res = await rejectUnlessLocalOrAuthenticated(
      new Request("http://127.0.0.1:3000/x", {
        headers: { host: "127.0.0.1:3000", "x-forwarded-for": "192.168.0.9" },
      }),
    );
    expect(res?.status).toBe(403);
  });
});
