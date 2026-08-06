import { NextResponse } from "next/server";
import { resolveHostControlUrl } from "@/lib/host-control";
import { isLocalHostRequest } from "@/lib/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Report whether the caller has to log in.
 *
 * Login is only enforced for non-loopback callers (LAN / reverse-proxied
 * remote clients). Someone already sitting at the host machine has full OS
 * access anyway, so a password would add friction without adding security.
 *
 * When no users are registered the feature is off everywhere: otherwise a
 * fresh install would show a login form that nobody can get past, since user
 * management itself is host-only.
 *
 * Fail-closed: if the host control plane cannot be reached we cannot tell
 * whether users exist, so remote callers are asked to log in.
 */
export async function GET(req: Request) {
  const local = isLocalHostRequest(req);

  let hasUsers: boolean;
  try {
    const res = await fetch(`${resolveHostControlUrl()}/users`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      hasUsers = true;
    } else {
      const data = (await res.json().catch(() => ({}))) as {
        users?: unknown;
      };
      hasUsers = Array.isArray(data.users) && data.users.length > 0;
    }
  } catch {
    hasUsers = true;
  }

  return NextResponse.json({
    local,
    hasUsers,
    loginRequired: !local && hasUsers,
  });
}
