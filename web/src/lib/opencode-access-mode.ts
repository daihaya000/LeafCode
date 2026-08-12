import { OcError, ocServer } from "@/lib/oc-server";
import type { AccessMode } from "@/lib/access-mode";

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
 * Direct child sessions inherit the same ceiling. Subagents otherwise start
 * with OpenCode's default `{ "*": "allow" }` and would rewrite files with no
 * approval card while the parent UI still said 確認する.
 */
export async function setSessionEditPermission(
  directory: string,
  sessionId: string,
  mode: AccessMode,
): Promise<void> {
  const id = sessionId.trim();
  if (!id || id.length > 256) {
    throw new OcError("invalid session", 400);
  }
  await patchSessionEditPermission(directory, id, mode);
  const children = await listChildSessionIds(directory, id);
  if (children.length === 0) return;
  await Promise.allSettled(
    children.map((childId) => patchSessionEditPermission(directory, childId, mode)),
  );
}
