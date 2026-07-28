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
 * Allows three trusted paths:
 * 1. Direct loopback access (Host is 127.0.0.1/localhost/::1).
 * 2. A trusted local reverse proxy (e.g. Caddy) where the browser uses a LAN
 *    hostname, but the immediate client hop seen by the proxy is loopback.
 * 3. A trusted local reverse proxy that rewrites the Host header to loopback
 *    for host-only API paths. In that case X-Forwarded-For may show the PC's
 *    own LAN IP because the browser connected via that interface.
 *
 * Remote clients (phones, other PCs, spoofed X-Forwarded-For) are rejected.
 *
 * When using Caddy with a LAN hostname, configure Caddy to send a loopback
 * Host header for host-only API paths (see deploy/Caddyfile.example).
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
  if (hostIsLoopback && forwardedIsLoopback) return true;

  // Caddy-style Host rewrite: the reverse proxy rewrites Host to 127.0.0.1:3000
  // for host-only API paths, but X-Forwarded-For can legitimately show the
  // PC's own LAN IP because the browser reached the proxy through the LAN
  // interface. Accept private-IP XFF only when Host is loopback, so random
  // LAN clients cannot spoof their way in with a non-loopback Host.
  if (hostIsLoopback && forwardedClient && isPrivateAddress(forwardedClient)) {
    return true;
  }

  return false;
}

/**
 * Best-effort check for restart requests initiated from the host or its LAN.
 *
 * Restart is intentionally less strict than folder picker / logs / voice input:
 * mobile devices on the same private network may need to restart OpenCode or
 * the WebUI while using the LAN URL. Public hosts remain rejected.
 */
export function isLocalOrPrivateNetworkRequest(req: Request): boolean {
  if (isLocalHostRequest(req)) return true;

  const hostHeader = req.headers.get("host") ?? "";
  const hostIsPrivate = isPrivateAddress(hostHeaderName(hostHeader));

  const forwarded = req.headers.get("x-forwarded-for");
  const forwardedClient = forwarded?.split(",")[0]?.trim() ?? "";
  const forwardedIsPrivate =
    forwardedClient && isPrivateAddress(forwardedClient);

  // Direct LAN access to Next.js, e.g. http://192.168.x.x:3000 from a phone.
  if (hostIsPrivate && !forwarded) return true;

  // LAN access through a same-machine reverse proxy that preserves the LAN Host.
  if (hostIsPrivate && forwardedIsPrivate) return true;

  return false;
}

/** True when `value` is an IPv4/IPv6 private address (RFC 1918 / RFC 4193). */
export function isPrivateAddress(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (isLoopbackAddress(v)) return true;
  // IPv4 RFC 1918.
  if (/^10\./.test(v)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(v)) return true;
  if (/^192\.168\./.test(v)) return true;
  // IPv6 unique local (fc00::/7).
  if (/^fc/.test(v) || /^fd/.test(v)) return true;
  // IPv4 link-local.
  if (/^169\.254\./.test(v)) return true;
  return false;
}

export function rejectUnlessLocal(req: Request): NextResponse | null {
  if (isLocalHostRequest(req)) return null;
  return NextResponse.json(
    { error: "this endpoint is only available from the host machine" },
    { status: 403 },
  );
}

export function rejectUnlessLocalOrPrivateNetwork(
  req: Request,
): NextResponse | null {
  if (isLocalOrPrivateNetworkRequest(req)) return null;
  return NextResponse.json(
    { error: "this endpoint is only available from the host machine or private network" },
    { status: 403 },
  );
}
