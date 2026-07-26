import { NextResponse } from "next/server";

const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "::1",
  "localhost",
  "0:0:0:0:0:0:0:1",
]);

/** True when `value` is a loopback host or IPv4/IPv6 address. */
export function isLoopbackAddress(value: string): boolean {
  const raw = value.trim().toLowerCase();
  if (!raw) return false;
  const v = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  if (LOOPBACK_HOSTS.has(v)) return true;
  if (v.startsWith("::ffff:")) return isLoopbackAddress(v.slice(7));
  return false;
}

/**
 * Extract hostname from a Host header, including bracketed IPv6 (`[::1]:3000`).
 */
export function hostHeaderName(hostHeader: string): string {
  const raw = hostHeader.trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end !== -1) return raw.slice(0, end + 1);
  }
  // IPv4 or hostname — strip :port (not IPv6 without brackets).
  const colon = raw.indexOf(":");
  return colon === -1 ? raw : raw.slice(0, colon);
}

/**
 * Best-effort check that the caller is on the host machine.
 * Requires Host to be loopback. When X-Forwarded-For is present (Caddy), the
 * client hop must also be loopback — so LAN phones are rejected and a spoofed
 * XFF alone cannot authorize a request whose Host is a LAN address.
 *
 * Open the UI via http://127.0.0.1:3000 or https://localhost:8443 /
 * https://127.0.0.1:8443 for host-only APIs.
 */
export function isLocalHostRequest(req: Request): boolean {
  const hostHeader = req.headers.get("host") ?? "";
  if (!isLoopbackAddress(hostHeaderName(hostHeader))) return false;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const client = forwarded.split(",")[0]?.trim() ?? "";
    return isLoopbackAddress(client);
  }
  return true;
}

export function rejectUnlessLocal(req: Request): NextResponse | null {
  if (isLocalHostRequest(req)) return null;
  return NextResponse.json(
    { error: "this endpoint is only available from the host machine" },
    { status: 403 },
  );
}
