import { OcError, ocServer } from "@/lib/oc-server";
import type { AccessMode } from "@/lib/access-mode";

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
  await ocServer(directory, `/session/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: {
      permission: [
        {
          permission: "edit",
          pattern: "*",
          // full: keep the engine silent (the WebUI would auto-approve anyway,
          // and an extra ask/reply round trip per write is pure latency).
          action: mode === "full" ? "allow" : "ask",
        },
      ],
    },
  });
}
