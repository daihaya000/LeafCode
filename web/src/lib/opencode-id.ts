/** OpenCode session / path id safety (reject traversal into other engine routes). */

const SAFE_OC_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeOpenCodeSessionId(id: string): boolean {
  return SAFE_OC_SESSION_ID.test(id);
}

export function assertSafeOpenCodeSessionId(id: string): void {
  if (!isSafeOpenCodeSessionId(id)) {
    throw new Error("invalid OpenCode session id");
  }
}

/**
 * Reject relative segments before `new URL(path, base)` resolves them away
 * from `/session/...` into e.g. `/auth/{provider}`.
 */
export function assertSafeOpenCodePath(path: string): void {
  if (!path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new Error("invalid OpenCode path");
  }
  const segments = path.split("/").slice(1);
  if (segments.some((s) => s === "." || s === ".." || s === "")) {
    throw new Error("invalid OpenCode path");
  }
}

/** Build `/session/{id}/...` with a single encoded id segment. */
export function openCodeSessionPath(
  sessionId: string,
  ...rest: string[]
): string {
  assertSafeOpenCodeSessionId(sessionId);
  const parts = [
    encodeURIComponent(sessionId),
    ...rest.map((s) => encodeURIComponent(s)),
  ];
  return `/session/${parts.join("/")}`;
}
