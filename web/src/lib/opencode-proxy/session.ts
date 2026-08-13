import { NextResponse } from "next/server";

/**
 * Session-path classification for the BFF proxy (REFACTORING_PLAN P4-a):
 * which session a write targets, whether it is a long-running sync mutation,
 * a permission ruleset write, an image-carrying write, or a compaction.
 */

export function manualSendSessionId(method: string, pathname: string): string | null {
  if (method !== "POST") return null;
  const match = /^(?:\/api)?\/session\/([^/]+)\/(?:prompt_async|prompt|command)$/.exec(pathname);
  return match ? match[1] : null;
}

/**
 * POST paths that start a turn, and therefore arm the server-side hang watchdog.
 * Wider than `manualSendSessionId` on purpose: every path that can leave a
 * session busy must be recoverable. See
 * docs/specs/hang-watchdog-server-side.md.
 */
export function hangWatchSessionId(method: string, pathname: string): string | null {
  if (method !== "POST") return null;
  const match = /^(?:\/api)?\/session\/([^/]+)\/(?:prompt_async|prompt|command|message)$/.exec(
    pathname,
  );
  return match ? match[1] : null;
}

/** An explicit user abort must cancel recovery for the stopped turn. */
export function abortedSessionId(method: string, pathname: string): string | null {
  if (method !== "POST") return null;
  const match = /^(?:\/api)?\/session\/([^/]+)\/(?:abort|interrupt)$/.exec(pathname);
  return match ? match[1] : null;
}

/** Match the synchronous, completion-blocking mutation endpoints. */
export function isLongRunningSyncMutation(method: string, pathname: string): boolean {
  if (method !== "POST") return false;
  return (
    /^(?:\/api)?\/session\/[^/]+\/command$/.test(pathname) ||
    /^(?:\/api)?\/session\/[^/]+\/prompt$/.test(pathname) ||
    /^(?:\/api)?\/session\/[^/]+\/message$/.test(pathname)
  );
}

/** Session create / update paths that accept a permission ruleset in the body. */
export function isSessionPermissionWrite(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  if (m === "POST") {
    return pathname === "/session" || pathname === "/api/session";
  }
  if (m === "PATCH") {
    return (
      /^\/session\/[^/]+$/.test(pathname) ||
      /^\/api\/session\/[^/]+$/.test(pathname)
    );
  }
  return false;
}

export function bodyHasPermissionField(body: unknown): boolean {
  return (
    !!body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.prototype.hasOwnProperty.call(body, "permission")
  );
}

/** Session write paths that can carry image parts (R28 limits + capability). */
export function isImageGuardedWrite(pathname: string): boolean {
  return (
    /^(?:\/api)?\/session\/[^/]+\/prompt_async$/.test(pathname) ||
    /^(?:\/api)?\/session\/[^/]+\/command$/.test(pathname) ||
    /^(?:\/api)?\/session\/[^/]+\/prompt$/.test(pathname) ||
    /^(?:\/api)?\/session\/[^/]+\/message$/.test(pathname)
  );
}

/** Match the explicit context-compaction mutation for a session. */
export function compactSessionId(method: string, pathname: string): string | null {
  if (method !== "POST") return null;
  const match = /^(?:\/api)?\/session\/([^/]+)\/compact$/.exec(pathname);
  return match ? match[1] : null;
}

export function compactLockConflict(): Response {
  return NextResponse.json(
    {
      error: "session compaction already in progress",
      code: "session_compaction_locked",
    },
    { status: 409 },
  );
}
