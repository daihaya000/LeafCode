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
 *
 * Allows two trusted paths:
 * 1. Direct loopback access (Host is 127.0.0.1/localhost/::1).
 * 2. A trusted local reverse proxy on the same machine (e.g. Caddy). In that
 *    case the browser may use a LAN hostname/IP, but the immediate client hop
 *    seen by the proxy (and reflected in X-Forwarded-For) is loopback.
 *
 * Any claim of a remote client IP is rejected, so LAN phones or external
 * spoofed X-Forwarded-For cannot authorize host-only APIs.
 *
 * Open the UI via http://127.0.0.1:3000, http://localhost:3000, or the Caddy
 * reverse proxy (https://localhost:8443, https://<LAN-IP>:8443) for host-only
 * APIs.
 */
export function isLocalHostRequest(req: Request): boolean {
  const hostHeader = req.headers.get("host") ?? "";
  const hostIsLoopback = isLoopbackAddress(hostHeaderName(hostHeader));

  const forwarded = req.headers.get("x-forwarded-for");
  const forwardedClient = forwarded?.split(",")[0]?.trim() ?? "";
  const forwardedIsLoopback =
    forwardedClient && isLoopbackAddress(forwardedClient);

  // Direct loopback access, no proxy involved.
  if (hostIsLoopback && !forwarded) return true;

  // Trusted local reverse proxy (Caddy on the same machine). The browser may
  // show a LAN hostname, but the immediate client hop is loopback.
  if (forwardedIsLoopback) return true;

  return false;
}

export function rejectUnlessLocal(req: Request): NextResponse | null {
  if (isLocalHostRequest(req)) return null;
  return NextResponse.json(
    { error: "this endpoint is only available from the host machine" },
    { status: 403 },
  );
}
