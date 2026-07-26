import { OcError, ocServer } from "@/lib/oc-server";
import type { SkillPermission } from "@/lib/skill-permission";

/**
 * Enforce the skill invocation permission for a single OpenCode session.
 *
 * IMPORTANT: this deliberately targets the *session*, not the agent config.
 * A `PATCH /config` write (agent.<name>.permission.skill) is silently ignored
 * by a running engine — OpenCode loads config once at startup and never
 * hot-reloads it, so that path was a no-op and skills kept running even when
 * the UI showed "不許可". The session-scoped ruleset below is evaluated live
 * by the permission engine and blocks the `skill` tool for every prompt and
 * command in the session.
 *
 * OpenCode appends the supplied rules to the session's existing ruleset and
 * evaluates the LAST matching rule, so writing `{ skill, *, <action> }` always
 * wins over any earlier rule (including a prior toggle in the other
 * direction) as well as the agent/config defaults.
 */
export async function setSessionSkillPermission(
  directory: string,
  sessionId: string,
  permission: SkillPermission,
): Promise<void> {
  const id = sessionId.trim();
  if (!id || id.length > 256) {
    throw new OcError("invalid session", 400);
  }
  await ocServer(directory, `/session/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: {
      permission: [{ permission: "skill", pattern: "*", action: permission }],
    },
  });
}
