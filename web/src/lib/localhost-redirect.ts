/**
 * Host-PC auto-redirect: when the browser is opened on the host machine via a
 * LAN/VPN IP (e.g. http://192.168.0.102:3000), redirect it to the loopback URL
 * so host-only features (login-free loopback, folder picker, voice input,
 * restart) keep working.
 *
 * Why this is safe to run on every navigation:
 * - A remote phone reaches the WebUI via the same LAN IP, but it has no
 *   loopback path back to this machine. The reachability probe below fails for
 *   it, so it is never redirected. Only a browser that can actually open
 *   127.0.0.1 on the host is moved.
 * - The probe targets the host's control plane on `http://127.0.0.1:18765/health`
 *   with `mode: "no-cors"`. The control server rejects any non-loopback Host
 *   header (DNS rebinding guard), and `/health` only ever returns a harmless
 *   JSON body. An opaque response (or a thrown network error on failure) is all
 *   we read — we never touch the response body.
 * - The redirect preserves protocol and port, only swapping the hostname for
 *   127.0.0.1. Loopback access is intentionally login-free, so no session state
 *   is lost by moving origins.
 */

const CONTROL_HEALTH_URL = "http://127.0.0.1:18765/health";
const PROBE_TIMEOUT_MS = 800;

const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "::1",
  "localhost",
  "0:0:0:0:0:0:0:1",
]);

/** True when `value` is a loopback host or IPv4/IPv6 address. */
export function isLoopbackHost(value: string): boolean {
  const raw = value.trim().toLowerCase();
  if (!raw) return false;
  const v = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  if (LOOPBACK_HOSTS.has(v)) return true;
  if (v.startsWith("::ffff:")) return isLoopbackHost(v.slice(7));
  return false;
}

/** True for a bare private IPv4/unique-local address (RFC 1918 / RFC 4193). */
export function isPrivateHost(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (isLoopbackHost(v)) return true;
  if (/^10\./.test(v)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(v)) return true;
  if (/^192\.168\./.test(v)) return true;
  if (/^fc/.test(v) || /^fd/.test(v)) return true;
  if (/^169\.254\./.test(v)) return true;
  return false;
}

/**
 * True when this browser is on the host machine and can reach its loopback
 * control plane. Resolves false on any timeout / network error (fail-closed).
 */
async function canReachHostLoopback(): Promise<boolean> {
  try {
    await fetch(CONTROL_HEALTH_URL, {
      mode: "no-cors",
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // With `no-cors` a successful request yields an opaque response; a failed
    // request throws a TypeError. Either way, no throw means reachable.
    return true;
  } catch {
    return false;
  }
}

function extractHostname(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end !== -1) return s.slice(1, end);
  }
  const colon = s.indexOf(":");
  return colon === -1 ? s : s.slice(0, colon);
}

/**
 * Redirect the current page to its loopback twin when (a) we are not already on
 * loopback, (b) the Host is a private/LAN address, and (c) the host control
 * plane on 127.0.0.1 is reachable (so this browser really is on the host PC).
 *
 * Runs only in the browser. Returns the target URL when a redirect was issued,
 * otherwise null.
 */
export async function maybeRedirectToLocalhost(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const hostname = extractHostname(window.location.hostname);
  if (isLoopbackHost(hostname)) return null;
  // Only redirect private-network hosts. A public hostname (e.g. a reverse
  // proxy domain) should be left alone — it may be the intended access path.
  if (!isPrivateHost(hostname)) return null;
  if (!(await canReachHostLoopback())) return null;

  const target = new URL(window.location.href);
  target.hostname = "127.0.0.1";
  const to = target.toString();
  window.location.replace(to);
  return to;
}
