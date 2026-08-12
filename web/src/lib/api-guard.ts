import { NextResponse } from "next/server";
import { hostHeaderName, isLocalHostRequest } from "@/lib/local-request";
import { verifySession } from "@/lib/session";

/**
 * The single authorization gate for `/api/**`.
 *
 * Two independent checks, in order:
 *
 * 1. **Cross-site origin rejection (CSRF).** Loopback callers are authorized
 *    without presenting any credential, so without this any website could drive
 *    the whole API while the operator browses on the host PC: a POST to
 *    `http://127.0.0.1:3000/api/...` with `Content-Type: text/plain` is a
 *    "simple request", so it is sent without a preflight and the side effect
 *    happens even though CORS hides the response.
 * 2. **Authorization.** Loopback, or a session cookie the host has verified.
 *
 * Only the handful of routes in `PUBLIC_API_ROUTES` may skip this. Everything
 * else is default-deny; `api-guard-coverage.test.ts` fails the build if a route
 * is added without a guard.
 */

/** Methods that can change state and therefore need CSRF protection. */
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Routes intentionally reachable without authorization.
 *
 * - `/api/health` is polled by the tray host supervisor and by Caddy; gating it
 *   would break process supervision. It reports liveness only.
 * - The auth routes are how an unauthenticated client discovers that it must log
 *   in and then does so, so they cannot require authorization themselves.
 */
export const PUBLIC_API_ROUTES = [
  "/api/health",
  "/api/auth/session",
  "/api/auth/login",
  "/api/auth/logout",
] as const;

function forbidden(error: string) {
  return NextResponse.json({ error }, { status: 403 });
}

/**
 * Extra origins allowed to make state-changing requests, e.g. a public hostname
 * terminated by a reverse proxy. Comma-separated, exact `scheme://host[:port]`.
 */
function configuredOrigins(): string[] {
  const raw = process.env.OPENCODE_WEBUI_ALLOWED_ORIGINS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, "").toLowerCase())
    .filter(Boolean);
}

/**
 * Origins that count as "this WebUI".
 *
 * Derived from the request's own `Host`, so it works for loopback, the host's
 * LAN address, and a proxied hostname alike without configuration. Both schemes
 * are accepted because the browser's origin uses the scheme it connected with,
 * which the BFF only learns from `X-Forwarded-Proto` when a proxy sets it.
 */
export function allowedOrigins(req: Request): string[] {
  const host = req.headers.get("host")?.trim().toLowerCase();
  const origins = new Set(configuredOrigins());
  if (host) {
    origins.add(`http://${host}`);
    origins.add(`https://${host}`);
  }
  return [...origins];
}

/**
 * Reject state-changing requests that a browser initiated from another site.
 *
 * A missing `Origin` is allowed: browsers always send it on state-changing
 * requests, so its absence means a non-browser client (curl, the smoke script),
 * which still has to pass the authorization check below. `Sec-Fetch-Site` is
 * honoured as a second signal in case a browser ever omits `Origin`.
 */
export function rejectCrossSite(req: Request): NextResponse | null {
  const method = (req.method ?? "GET").toUpperCase();
  if (!STATE_CHANGING.has(method)) return null;

  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return forbidden("cross-site requests are not allowed");
  }

  const origin = req.headers.get("origin");
  if (origin === null || origin === "" || origin === "null") {
    // `Origin: null` comes from sandboxed/opaque origins (e.g. a sandboxed
    // iframe). It carries no usable host to match, so it is rejected outright
    // rather than treated like an absent header.
    return origin === "null"
      ? forbidden("cross-site requests are not allowed")
      : null;
  }

  const normalized = origin.trim().replace(/\/+$/, "").toLowerCase();
  if (allowedOrigins(req).includes(normalized)) return null;

  // A same-host origin on a different port is still cross-origin, but it is our
  // own reverse proxy in every supported setup, so compare hosts as a fallback
  // only when the configured list is empty.
  try {
    const originHost = new URL(normalized).host.toLowerCase();
    const requestHost = hostHeaderName(req.headers.get("host") ?? "");
    if (originHost && requestHost && originHost.split(":")[0] === requestHost) {
      return null;
    }
  } catch {
    return forbidden("malformed Origin header");
  }

  return forbidden("cross-site requests are not allowed");
}

/**
 * Full gate: CSRF, then authorization. Returns a response to send, or null to
 * continue.
 */
export async function requireAuthorized(
  req: Request,
): Promise<NextResponse | null> {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;

  if (isLocalHostRequest(req)) return null;
  if (await verifySession(req)) return null;

  return forbidden("this endpoint requires the host machine or a signed-in session");
}

/**
 * Gate for routes that must stay on the host machine even for signed-in users.
 * Currently unused by any route, kept so the distinction stays expressible.
 */
export async function requireHostMachine(
  req: Request,
): Promise<NextResponse | null> {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  if (isLocalHostRequest(req)) return null;
  return forbidden("this endpoint is only available from the host machine");
}
