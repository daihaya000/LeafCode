import { describe, expect, it } from "vitest";
import {
  hostHeaderName,
  isLocalOrPrivateNetworkRequest,
  isLocalHostRequest,
  isLoopbackAddress,
  isPrivateAddress,
  rejectUnlessLocal,
  rejectUnlessLocalOrPrivateNetwork,
} from "./local-request";

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
});

describe("isPrivateAddress", () => {
  it("accepts private LAN ranges and rejects public hosts", () => {
    expect(isPrivateAddress("192.168.0.102")).toBe(true);
    expect(isPrivateAddress("10.0.0.5")).toBe(true);
    expect(isPrivateAddress("172.16.0.5")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
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
  it("returns null for LAN callers", () => {
    expect(
      rejectUnlessLocalOrPrivateNetwork(
        new Request("http://192.168.0.102:3000/x", {
          headers: { host: "192.168.0.102:3000" },
        }),
      ),
    ).toBeNull();
  });
});
