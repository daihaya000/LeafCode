import { resolveHostControlUrl } from "@/lib/host-control";

/**
 * Server-side session verification for the BFF.
 *
 * The session token is an HMAC signed by the tray host with a secret that only
 * the host process holds, so the BFF cannot check the signature locally. It
 * forwards the browser's `webui_session` cookie to the host control plane
 * instead.
 *
 * Without this, the login gate would be cosmetic: `LoginGate` only hides the UI
 * based on localStorage, so any LAN client could reach the same APIs with curl.
 */

export const SESSION_COOKIE = "webui_session";
export const TRUSTED_DEVICE_COOKIE = "webui_trusted_device";

/** Extract the session token from a Cookie header value. */
export function sessionTokenFromCookieHeader(
  header: string | null | undefined,
): string | null {
  if (!header) return null;
  // Cookie names are case-sensitive and must match at a boundary, so a cookie
  // like `not_webui_session` cannot be mistaken for ours.
  const match = header.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]*)`),
  );
  if (!match) return null;
  const raw = match[1] ?? "";
  if (!raw) return null;
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    // A malformed percent-encoding cannot be a token we issued.
    return null;
  }
}

function trustedDeviceTokenFromCookieHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${TRUSTED_DEVICE_COOKIE}=([^;]*)`));
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]) || null;
  } catch {
    return null;
  }
}

export type VerifiedSession = { username: string };

/**
 * Verify the caller's session against the host control plane.
 *
 * Returns null for any failure — missing cookie, bad signature, expired token,
 * or an unreachable host. Failing closed matters here: this is the only thing
 * standing between a LAN client and the host-only APIs.
 */
export async function verifySession(
  req: Request,
): Promise<VerifiedSession | null> {
  const token = sessionTokenFromCookieHeader(req.headers.get("cookie"));
  const trustedDeviceToken = trustedDeviceTokenFromCookieHeader(req.headers.get("cookie"));
  if (!token && !trustedDeviceToken) return null;

  try {
    const res = await fetch(`${resolveHostControlUrl()}/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, trustedDeviceToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as {
      ok?: unknown;
      username?: unknown;
    };
    if (data.ok !== true || typeof data.username !== "string" || !data.username) {
      return null;
    }
    return { username: data.username };
  } catch {
    return null;
  }
}
