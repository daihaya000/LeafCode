import { describe, expect, it } from "vitest";
import {
  hostHeaderName,
  isLocalHostRequest,
  isLoopbackAddress,
  rejectUnlessLocal,
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
  it("rejects LAN Host without X-Forwarded-For", () => {
    expect(
      isLocalHostRequest(
        new Request("http://192.168.0.102:3000/x", {
          headers: { host: "192.168.0.102:3000" },
        }),
      ),
    ).toBe(false);
  });

  it("accepts loopback Host with loopback X-Forwarded-For (Caddy)", () => {
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

  it("rejects loopback Host with LAN X-Forwarded-For", () => {
    expect(
      isLocalHostRequest(
        new Request("http://127.0.0.1:3000/x", {
          headers: {
            host: "localhost:8443",
            "x-forwarded-for": "192.168.0.50",
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

  it("rejects direct LAN Host", () => {
    expect(
      isLocalHostRequest(
        new Request("http://192.168.0.102:3000/x", {
          headers: { host: "192.168.0.102:3000" },
        }),
      ),
    ).toBe(false);
  });

  it("accepts LAN Host with loopback X-Forwarded-For (trusted local reverse proxy)", () => {
    expect(
      isLocalHostRequest(
        new Request("http://192.168.0.102:8443/x", {
          headers: {
            host: "192.168.0.102:8443",
            "x-forwarded-for": "127.0.0.1",
          },
        }),
      ),
    ).toBe(true);
  });

  it("rejects LAN Host with remote X-Forwarded-For (reverse proxy from another device)", () => {
    expect(
      isLocalHostRequest(
        new Request("http://192.168.0.102:8443/x", {
          headers: {
            host: "192.168.0.102:8443",
            "x-forwarded-for": "192.168.0.50",
          },
        }),
      ),
    ).toBe(false);
  });
});

describe("rejectUnlessLocal", () => {
  it("returns 403 for non-local callers", async () => {
    const res = rejectUnlessLocal(
      new Request("http://192.168.0.1:3000/x", {
        headers: { host: "192.168.0.1:3000" },
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
