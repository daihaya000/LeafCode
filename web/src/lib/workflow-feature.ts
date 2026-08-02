/**
 * Workflow execution is opt-in while the feature is being introduced. Keep
 * environment parsing in one server-side helper so API and scheduler gates
 * cannot drift.
 */
export const DEFAULT_WORKFLOW_MODE_ENABLED = false;

export function resolveWorkflowModeEnabled(
  raw: string | undefined,
  defaultValue = DEFAULT_WORKFLOW_MODE_ENABLED,
): boolean {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return defaultValue;
}

export function isWorkflowModeEnabled(): boolean {
  return resolveWorkflowModeEnabled(process.env.OPENCODE_WEBUI_WORKFLOW_MODE);
}
