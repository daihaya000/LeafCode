import { describe, expect, it } from "vitest";
import {
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

describe("isLocalHostRequest", () => {
  it("uses the leftmost X-Forwarded-For hop when present", () => {
    expect(
      isLocalHostRequest(
        new Request("http://127.0.0.1:3000/x", {
          headers: { "x-forwarded-for": "127.0.0.1, 10.0.0.1" },
        }),
      ),
    ).toBe(true);
    expect(
      isLocalHostRequest(
        new Request("http://127.0.0.1:3000/x", {
          headers: { "x-forwarded-for": "192.168.0.50" },
        }),
      ),
    ).toBe(false);
  });

  it("falls back to Host when no proxy header", () => {
    expect(
      isLocalHostRequest(
        new Request("http://127.0.0.1:3000/x", {
          headers: { host: "127.0.0.1:3000" },
        }),
      ),
    ).toBe(true);
    expect(
      isLocalHostRequest(
        new Request("http://192.168.0.102:3000/x", {
          headers: { host: "192.168.0.102:3000" },
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
