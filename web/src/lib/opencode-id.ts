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

function decodePathSegment(raw: string): string {
  let decoded = raw;
  // Collapse nested encoding (%252e → %2e → .) before classifying.
  for (let i = 0; i < 4; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      throw new Error("invalid OpenCode path");
    }
  }
  return decoded;
}

/**
 * Reject relative segments before `new URL(path, base)` resolves them away
 * from `/session/...` into e.g. `/auth/{provider}`. Handles percent-encoded
 * forms such as `%2e%2e` and double-encoding.
 */
export function assertSafeOpenCodePath(path: string): void {
  if (!path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new Error("invalid OpenCode path");
  }
  const segments = path.split("/").slice(1);
  for (const raw of segments) {
    const decoded = decodePathSegment(raw);
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded === "" ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes("\0")
    ) {
      throw new Error("invalid OpenCode path");
    }
  }
}

/**
 * Pathname after URL resolution against the OpenCode base (what fetch actually hits).
 */
export function resolvedOpenCodePathname(
  path: string,
  baseUrl: string,
): string {
  assertSafeOpenCodePath(path);
  const resolved = new URL(path, baseUrl).pathname;
  return resolved.replace(/\/+$/, "") || "/";
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
