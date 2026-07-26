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
 * Best-effort check that the caller is on the host machine.
 * Prefers X-Forwarded-For (Caddy) so LAN clients behind the proxy are rejected;
 * without a proxy header, requires Host to be loopback (blocks direct LAN hits).
 *
 * Note: Host can be spoofed on direct :3000 access; combine with input hardening
 * on dangerous endpoints. Access via the machine's LAN hostname from the same PC
 * is intentionally rejected — use http://127.0.0.1:3000 or https://localhost:8443.
 */
export function isLocalHostRequest(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const client = forwarded.split(",")[0]?.trim() ?? "";
    return isLoopbackAddress(client);
  }
  const hostHeader = req.headers.get("host") ?? "";
  const host = hostHeader.split(":")[0]?.trim() ?? "";
  return isLoopbackAddress(host);
}

export function rejectUnlessLocal(req: Request): NextResponse | null {
  if (isLocalHostRequest(req)) return null;
  return NextResponse.json(
    { error: "this endpoint is only available from the host machine" },
    { status: 403 },
  );
}
