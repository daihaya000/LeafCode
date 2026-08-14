/**
 * Best-effort source address of a request, for audit logging and rate limiting.
 *
 * **Never use this for authorization.** `isLocalHostRequest` exists for that and
 * deliberately refuses to trust private `X-Forwarded-For` values.
 *
 * The value is taken from the *rightmost* `X-Forwarded-For` entry, not the
 * leftmost. Our reverse proxy (Caddy) appends the address it actually saw to
 * whatever the client sent, so the rightmost entry is the one our own
 * infrastructure produced. The leftmost entry is fully attacker-controlled: a
 * client that sends `X-Forwarded-For: 1.2.3.4` would otherwise be able to
 * invent a new source address on every request and walk straight through a
 * per-IP rate limit.
 *
 * Returns null when the address cannot be established. That happens when the
 * BFF is bound directly to the LAN with no proxy in front
 * (`LEAFCODE_HOST=0.0.0.0`), because Next.js route handlers do not expose
 * the socket peer address. Callers must treat null as "unknown", not as a
 * shared bucket, or every unproxied client would share one rate-limit counter.
 */
export function clientIpFromRequest(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (!forwarded) return null;

  const hops = forwarded
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (hops.length === 0) return null;

  const nearest = hops[hops.length - 1];
  return normalizeIp(nearest);
}

/** Strip an IPv6 bracket/zone and the IPv4-mapped IPv6 prefix. */
function normalizeIp(value: string): string | null {
  let ip = value.trim().toLowerCase();
  if (!ip) return null;

  // `[::1]:1234` or `[::1]`
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    if (end === -1) return null;
    ip = ip.slice(1, end);
  } else if (ip.split(":").length === 2) {
    // Exactly one colon means `host:port` (`1.2.3.4:5678`). A bare IPv6
    // address always has at least two, so it is left alone — an earlier
    // "no colon after the last one" check wrongly truncated `2001:db8::1`.
    ip = ip.slice(0, ip.indexOf(":"));
  }

  // `::ffff:192.0.2.1` is just an IPv4 address.
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  // Drop a link-local zone index (`fe80::1%eth0`).
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);

  return ip || null;
}
