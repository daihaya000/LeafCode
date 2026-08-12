import { OcError, ocServer } from "@/lib/oc-server";
import type { AccessMode } from "@/lib/access-mode";

/** Max nesting depth when applying the edit ceiling to descendant sessions. */
export const MAX_SESSION_DESCENDANT_DEPTH = 8;

function editRule(mode: AccessMode) {
  return {
    permission: "edit",
    pattern: "*",
    // full: keep the engine silent (the WebUI would auto-approve anyway,
    // and an extra ask/reply round trip per write is pure latency).
    action: mode === "full" ? "allow" : "ask",
  };
}

function childIdsFrom(data: unknown, parentId: string): string[] {
  const rows = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        Array.isArray((data as { data?: unknown }).data)
      ? (data as { data: unknown[] }).data
      : [];
  const ids: string[] = [];
  for (const row of rows) {
    const id =
      typeof row === "string"
        ? row
        : row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"
          ? (row as { id: string }).id.trim()
          : "";
    if (!id || id === parentId || id.length > 256) continue;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Direct OpenCode child sessions of a bound parent. Empty on fetch failure. */
export async function listChildSessionIds(
  directory: string,
  parentSessionId: string,
): Promise<string[]> {
  const id = parentSessionId.trim();
  if (!id || id.length > 256) return [];
  try {
    const list = await ocServer<unknown>(
      directory,
      `/session/${encodeURIComponent(id)}/children`,
    );
    return childIdsFrom(list, id);
  } catch {
    return [];
  }
}

/**
 * Breadth-first descendants of a parent session (not including the parent).
 * Caps depth so a pathological nesting graph cannot hang the access-mode path.
 */
export async function listDescendantSessionIds(
  directory: string,
  parentSessionId: string,
  maxDepth: number = MAX_SESSION_DESCENDANT_DEPTH,
): Promise<string[]> {
  const root = parentSessionId.trim();
  if (!root || root.length > 256) return [];
  const out: string[] = [];
  const seen = new Set<string>([root]);
  let frontier = [root];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      const children = await listChildSessionIds(directory, id);
      for (const child of children) {
        if (seen.has(child)) continue;
        seen.add(child);
        out.push(child);
        next.push(child);
      }
    }
    frontier = next;
  }
  return out;
}

async function patchSessionEditPermission(
  directory: string,
  sessionId: string,
  mode: AccessMode,
): Promise<void> {
  await ocServer(directory, `/session/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: { permission: [editRule(mode)] },
  });
}

/** Read `parentID` for a session. Null when missing or the fetch fails. */
export async function fetchSessionParentId(
  directory: string,
  sessionId: string,
): Promise<string | null> {
  const id = sessionId.trim();
  if (!id || id.length > 256) return null;
  try {
    const info = await ocServer<unknown>(
      directory,
      `/session/${encodeURIComponent(id)}`,
    );
    if (!info || typeof info !== "object") return null;
    const parent = (info as { parentID?: unknown }).parentID;
    return typeof parent === "string" && parent.trim() ? parent.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Walk `parentID` links to see whether `sessionId` is under any of `rootIds`.
 * Used when `/children` lags behind `session.created` and we still need to
 * authorize an explicit ensure-id PATCH.
 */
export async function isSessionUnderRoots(
  directory: string,
  sessionId: string,
  rootIds: ReadonlySet<string>,
): Promise<boolean> {
  const id = sessionId.trim();
  if (!id || id.length > 256) return false;
  if (rootIds.has(id)) return true;
  let current = id;
  const seen = new Set<string>();
  for (let depth = 0; depth < MAX_SESSION_DESCENDANT_DEPTH; depth++) {
    if (seen.has(current)) return false;
    seen.add(current);
    const parent = await fetchSessionParentId(directory, current);
    if (!parent) return false;
    if (rootIds.has(parent)) return true;
    current = parent;
  }
  return false;
}

/**
 * Enforce the アクセスモード ceiling for file writes in a single OpenCode
 * session.
 *
 * WHY THIS EXISTS: アクセスモード was purely client-side — "確認する" only meant
 * "WebUI does not auto-approve". It never told the engine to ask. OpenCode's
 * built-in default ruleset starts with `{ "*": "allow" }` (only doom_loop,
 * external_directory, `read` of .env files and the plan/question pseudo
 * permissions differ), so `edit` was allowed outright and no `permission.asked`
 * event was ever emitted. Result: apply_patch (and edit / write) rewrote files
 * with no approval card while the UI said 確認する.
 *
 * The `edit` key covers all three write tools: `edit`, `write` and
 * `apply_patch` all call `assert({ action: "edit" })` in the engine, so one
 * rule gates every file mutation. `bash` is deliberately left alone so a
 * user's own `permission.bash` config (e.g. `"*": "allow"` with `git push*`:
 * "ask") keeps working.
 *
 * As with the task / skill rulesets this targets the *session*, not the config:
 * a running engine loads config once at startup and never hot-reloads it, and
 * session rules are appended and evaluated LAST, so this always wins over the
 * agent/config defaults and over a previous toggle in the other direction.
 *
 * Descendant sessions (direct children and nested grandchildren) inherit the
 * same ceiling. Subagents otherwise start with OpenCode's default
 * `{ "*": "allow" }` and would rewrite files with no approval card while the
 * parent UI still said 確認する.
 *
 * `ensureSessionIds` PATCHes sessions that `session.created` already revealed
 * even when `/children` still returns empty (listing lag). Those ids are
 * patched **before** the descendant BFS so a brand-new subagent cannot write
 * under OpenCode's default allow while `/children` walks the tree. Callers
 * must have already verified those ids belong under this parent tree.
 */
export async function setSessionEditPermission(
  directory: string,
  sessionId: string,
  mode: AccessMode,
  ensureSessionIds: readonly string[] = [],
): Promise<void> {
  const id = sessionId.trim();
  if (!id || id.length > 256) {
    throw new OcError("invalid session", 400);
  }
  const ensured = [
    ...new Set(
      ensureSessionIds
        .map((value) => value.trim())
        .filter((value) => value && value !== id && value.length <= 256),
    ),
  ];
  // Parent + session.created children first. Listing `/children` can take
  // many serial RTTs (depth up to MAX_SESSION_DESCENDANT_DEPTH); delaying
  // ensure ids until after that walk reopens the default-allow write window.
  await Promise.allSettled([
    patchSessionEditPermission(directory, id, mode),
    ...ensured.map((childId) =>
      patchSessionEditPermission(directory, childId, mode),
    ),
  ]);
  const descendants = await listDescendantSessionIds(directory, id);
  const remaining = descendants.filter(
    (childId) => childId !== id && !ensured.includes(childId),
  );
  if (remaining.length === 0) return;
  await Promise.allSettled(
    remaining.map((childId) => patchSessionEditPermission(directory, childId, mode)),
  );
}

/**
 * True when a `session.created` SSE payload is a descendant of `rootSessionId`
 * (direct child, or child of a previously tracked descendant).
 */
export function shouldSyncAccessCeilingForSessionCreated(opts: {
  rootSessionId: string;
  parentID: string | undefined;
  sessionID: string | undefined;
  knownDescendants: ReadonlySet<string>;
}): { track: true; sessionID: string } | { track: false } {
  const root = opts.rootSessionId.trim();
  const parentID = opts.parentID?.trim() ?? "";
  const sessionID = opts.sessionID?.trim() ?? "";
  if (!root || !parentID || !sessionID) return { track: false };
  if (sessionID === root || sessionID.length > 256) return { track: false };
  if (parentID !== root && !opts.knownDescendants.has(parentID)) {
    return { track: false };
  }
  return { track: true, sessionID };
}
