/**
 * Loopback host detection shared by the web UI (via `loopback.d.mts`), the
 * tray host (`host/src/caddy-sites.js`) and scripts (REFACTORING_PLAN P1-c /
 * IMPROVEMENT 6-3). The web implementation is the evolution: bracket
 * stripping, `::ffff:` prefix and the full IPv6 loopback spelling are all
 * handled here.
 */

const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "::1",
  "localhost",
  "0:0:0:0:0:0:0:1",
]);

/** True when `value` is a loopback host or IPv4/IPv6 address. */
export function isLoopbackHost(value) {
  const raw = value.trim().toLowerCase();
  if (!raw) return false;
  const v = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  if (LOOPBACK_HOSTS.has(v)) return true;
  if (v.startsWith("::ffff:")) return isLoopbackHost(v.slice(7));
  return false;
}
