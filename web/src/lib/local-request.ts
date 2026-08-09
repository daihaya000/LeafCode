import { NextResponse } from "next/server";
import { verifySession } from "@/lib/session";

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
 * Best-effort check that the caller is on the host machine (fail-safe).
 *
 * Only direct loopback access is trusted:
 * 1. Direct loopback access with no proxy involved (Host is loopback and
 *    there is no X-Forwarded-For header).
 * 2. A same-machine reverse proxy (e.g. Caddy) where the browser is on the
 *    host PC and reaches the proxy via a loopback hostname, so the immediate
 *    client hop recorded in X-Forwarded-For is loopback.
 *
 * Private X-Forwarded-For values are NOT trusted. A LAN attacker can spoof
 * that header, and a Caddy-proxied LAN/remote client must not reach host-only
 * APIs without authentication even when Caddy rewrites the Host header to
 * loopback. Open host-only URLs on the host PC via a loopback hostname
 * (http://127.0.0.1:3000, http://localhost:3000, https://localhost:8443).
 */
export function isLocalHostRequest(req: Request): boolean {
  const hostHeader = req.headers.get("host") ?? "";
  const hostIsLoopback = isLoopbackAddress(hostHeaderName(hostHeader));
  if (!hostIsLoopback) return false;

  const forwarded = req.headers.get("x-forwarded-for");
  // No proxy header: direct loopback access to the BFF.
  if (!forwarded) return true;

  const forwardedClient = forwarded.split(",")[0]?.trim() ?? "";
  // A proxy is involved: only trust it when the immediate client hop is
  // loopback (browser on the same PC reaching the proxy via loopback).
  // Reject private/non-loopback XFF so spoofed headers and Caddy-proxied LAN
  // clients cannot reach host-only APIs without auth.
  return forwardedClient !== "" && isLoopbackAddress(forwardedClient);
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
  // Tailscale and several other VPNs use the shared CGNAT range.
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v)) return true;
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

/**
 * Allow the host machine, or any caller holding a session verified by the host.
 *
 * This is the default guard for host-facing APIs. A verified session is a
 * strictly stronger authorization signal than the loopback heuristic: the token
 * is HMAC-signed by the tray host, whereas `Host` / `X-Forwarded-For` can be
 * spoofed by anyone on the LAN.
 *
 * Use `rejectUnlessLocal` instead for the few operations that are meaningless
 * remotely because they drive the host's own desktop — see
 * `/api/browse/folder`, which opens a dialog on the host screen.
 */
export async function rejectUnlessLocalOrAuthenticated(
  req: Request,
): Promise<NextResponse | null> {
  if (isLocalHostRequest(req)) return null;
  if (await verifySession(req)) return null;
  return NextResponse.json(
    {
      error:
        "this endpoint requires the host machine or a signed-in session",
    },
    { status: 403 },
  );
}

export async function rejectUnlessLocalOrPrivateNetwork(
  req: Request,
): Promise<NextResponse | null> {
  if (isLocalOrPrivateNetworkRequest(req)) return null;
  // A signed-in caller is allowed even from outside the private network, e.g. a
  // phone reaching the WebUI through a reverse proxy on a public hostname.
  if (await verifySession(req)) return null;
  return NextResponse.json(
    { error: "this endpoint is only available from the host machine or private network" },
    { status: 403 },
  );
}
