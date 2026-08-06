import { NextResponse } from "next/server";
import { resolveHostControlUrl } from "@/lib/host-control";
import { isLocalHostRequest } from "@/lib/local-request";
import { verifySession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Report whether the caller has to log in.
 *
 * Login is only enforced for non-loopback callers (LAN / reverse-proxied
 * remote clients). Someone already sitting at the host machine has full OS
 * access anyway, so a password would add friction without adding security.
 *
 * The gate also needs something to authenticate against — either a registered
 * users.json entry or Windows-account login. With neither, a fresh install
 * would show a login form that nobody can get past, since both user management
 * and the Windows-auth toggle are host-only.
 *
 * Reads /auth/config rather than /users so the username list never has to be
 * fetched just to answer "is a login needed?".
 *
 * Fail-closed: if the host control plane cannot be reached we cannot tell
 * whether credentials exist, so remote callers are asked to log in.
 */
export async function GET(req: Request) {
  const local = isLocalHostRequest(req);

  let hasUsers = true;
  let windowsAuth = false;
  try {
    const res = await fetch(`${resolveHostControlUrl()}/auth/config`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      hasUsers = data.hasUsers === true;
      windowsAuth = data.windowsAuth === true;
    }
  } catch {
    // keep the fail-closed defaults
  }

  const canAuthenticate = hasUsers || windowsAuth;

  // Report the cookie's real state so the client gate does not rely on
  // localStorage. The host regenerates its signing secret on every restart, so a
  // stale localStorage entry would otherwise show the app while every API 403s.
  const session = await verifySession(req);

  return NextResponse.json({
    local,
    hasUsers,
    windowsAuth,
    canAuthenticate,
    loginRequired: !local && canAuthenticate,
    authenticated: session !== null,
    username: session?.username ?? null,
  });
}
