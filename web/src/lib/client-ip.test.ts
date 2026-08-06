import { describe, expect, it } from "vitest";
import { clientIpFromRequest } from "./client-ip";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:3000/api/auth/login", {
    method: "POST",
    headers,
  });
}

describe("clientIpFromRequest", () => {
  it("returns null when there is no proxy header", () => {
    // Next.js does not expose the socket peer, so an unproxied request has no
    // knowable address. Callers must treat this as "unknown".
    expect(clientIpFromRequest(req())).toBeNull();
  });

  it("returns the single forwarded address", () => {
    expect(clientIpFromRequest(req({ "x-forwarded-for": "192.168.0.5" }))).toBe(
      "192.168.0.5",
    );
  });

  it("uses the rightmost hop, which our own proxy appended", () => {
    // The leftmost entry is whatever the client sent, so trusting it would let
    // an attacker invent a fresh address per request and evade a per-IP limit.
    expect(
      clientIpFromRequest(req({ "x-forwarded-for": "1.2.3.4, 192.168.0.5" })),
    ).toBe("192.168.0.5");
  });

  it("ignores a spoofed leftmost entry even when it looks like many hops", () => {
    expect(
      clientIpFromRequest(
        req({ "x-forwarded-for": "9.9.9.9, 8.8.8.8, 7.7.7.7, 192.168.0.5" }),
      ),
    ).toBe("192.168.0.5");
  });

  it("tolerates whitespace and empty entries", () => {
    expect(
      clientIpFromRequest(req({ "x-forwarded-for": " 1.2.3.4 , , 192.168.0.5 " })),
    ).toBe("192.168.0.5");
  });

  it("returns null for an empty or comma-only header", () => {
    expect(clientIpFromRequest(req({ "x-forwarded-for": "" }))).toBeNull();
    expect(clientIpFromRequest(req({ "x-forwarded-for": " , , " }))).toBeNull();
  });

  it("strips a port from an IPv4 address", () => {
    expect(clientIpFromRequest(req({ "x-forwarded-for": "192.168.0.5:51234" }))).toBe(
      "192.168.0.5",
    );
  });

  it("unwraps a bracketed IPv6 address with a port", () => {
    expect(clientIpFromRequest(req({ "x-forwarded-for": "[::1]:51234" }))).toBe("::1");
  });

  it("keeps a bare IPv6 address intact", () => {
    expect(clientIpFromRequest(req({ "x-forwarded-for": "2001:db8::1" }))).toBe(
      "2001:db8::1",
    );
  });

  it("normalises an IPv4-mapped IPv6 address", () => {
    // ::ffff:192.0.2.1 and 192.0.2.1 must share one rate-limit bucket.
    expect(clientIpFromRequest(req({ "x-forwarded-for": "::ffff:192.0.2.1" }))).toBe(
      "192.0.2.1",
    );
  });

  it("drops an IPv6 zone index", () => {
    expect(clientIpFromRequest(req({ "x-forwarded-for": "fe80::1%eth0" }))).toBe(
      "fe80::1",
    );
  });

  it("lowercases the address so casing cannot split a bucket", () => {
    expect(clientIpFromRequest(req({ "x-forwarded-for": "2001:DB8::AB" }))).toBe(
      "2001:db8::ab",
    );
  });
});
