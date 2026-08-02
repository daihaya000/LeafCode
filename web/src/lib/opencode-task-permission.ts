import { OcError, ocServer } from "@/lib/oc-server";

export type TaskPermission = "allow" | "deny";

export type SessionPermissionRule = {
  permission: string;
  pattern: string;
  action: TaskPermission;
};

export type WorkflowSessionPermissions = {
  write: boolean;
  subagent: boolean;
  browser: boolean;
};

const REVIEWER_WRITE_DENIES = [
  "edit",
  "write",
  "patch",
  "git",
  "bash",
  "shell",
  "terminal",
] as const;

/** Apply all session-scoped Workflow rules in one PATCH before any prompt. */
export async function setSessionPermissionRules(
  directory: string,
  sessionId: string,
  rules: readonly SessionPermissionRule[],
): Promise<void> {
  const id = sessionId.trim();
  if (!id || id.length > 256) {
    throw new OcError("invalid session", 400);
  }
  await ocServer(directory, `/session/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { permission: rules },
  });
}

/**
 * Enforce the "subagent launch" (task tool) permission for a single OpenCode
 * session.
 *
 * IMPORTANT: this deliberately targets the *session*, not the agent config.
 * A `PATCH /config` write (agent.<name>.permission.task) is silently ignored
 * by a running engine — OpenCode loads config once at startup and never
 * hot-reloads it, so that path was a no-op and subagents kept launching even
 * when the UI showed "不許可". The session-scoped ruleset below is evaluated
 * live by the permission engine and blocks the `task` tool for every prompt
 * and command in the session (verified: task launch → child session is
 * created only when the rule is "allow").
 *
 * OpenCode appends the supplied rules to the session's existing ruleset and
 * evaluates the LAST matching rule, so writing `{ task, *, <action> }` always
 * wins over any earlier rule (including a prior toggle in the other
 * direction) as well as the agent/config defaults.
 */
export async function setSessionTaskPermission(
  directory: string,
  sessionId: string,
  permission: TaskPermission,
): Promise<void> {
  await setSessionPermissionRules(directory, sessionId, [
    { permission: "task", pattern: "*", action: permission },
  ]);
}

/**
 * Enforce the Workflow Node permission ceiling server-side. This is a single
 * request so the first prompt cannot race an incomplete ruleset.
 */
export async function applyWorkflowSessionPermissions(
  directory: string,
  sessionId: string,
  permissions: WorkflowSessionPermissions,
): Promise<void> {
  const rules: SessionPermissionRule[] = [];
  if (!permissions.write) {
    for (const permission of REVIEWER_WRITE_DENIES) {
      rules.push({ permission, pattern: "*", action: "deny" });
    }
  }
  if (!permissions.subagent) {
    rules.push(
      { permission: "task", pattern: "*", action: "deny" },
      { permission: "skill", pattern: "*", action: "deny" },
    );
  }
  if (!permissions.browser) {
    rules.push({ permission: "browser_*", pattern: "*", action: "deny" });
  }
  if (rules.length === 0) return;
  await setSessionPermissionRules(directory, sessionId, rules);
}
