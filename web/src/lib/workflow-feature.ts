/**
 * Workflow execution is opt-in while the feature is being introduced. Keep
 * environment parsing in one server-side helper so API and scheduler gates
 * cannot drift.
 *
 * Resolution precedence (server-side):
 *   1. `settings` table row `workflow-mode` — the user-facing toggle from the
 *      Settings screen (source of truth once flipped).
 *   2. `OPENCODE_WEBUI_WORKFLOW_MODE` / `NEXT_PUBLIC_OPENCODE_WEBUI_WORKFLOW_MODE`
 *      env var — initial rollout flag, used only when no DB row exists.
 *   3. {@link DEFAULT_WORKFLOW_MODE_ENABLED} (false).
 *
 * The client (browser) cannot read the `settings` table directly, so the
 * client-visible helpers fall back to the `NEXT_PUBLIC_*` env value. The
 * server-side helper {@link isWorkflowModeEnabled} reads the DB via
 * {@link resolveWorkflowModeServer} and is what the scheduler and workflow
 * API routes use.
 */
import { getSetting } from "./db";

export const DEFAULT_WORKFLOW_MODE_ENABLED = false;
export const DEFAULT_WORKFLOW_GRAPH_ENABLED = false;
export const DEFAULT_WORKFLOW_GRAPH_EDIT_ENABLED = false;

/** Server-side `settings` key mirrored in the settings route allowlist. */
export const WORKFLOW_MODE_SETTING_KEY = "workflow-mode";

export type WorkflowGraphRolloutPhase = "legacy" | "graph_readonly" | "graph_edit";
export type WorkflowGraphRollout = {
  workflowEnabled: boolean;
  graphEnabled: boolean;
  graphEditEnabled: boolean;
  phase: WorkflowGraphRolloutPhase;
  reason: "workflow_disabled" | "graph_disabled" | "graph_readonly" | "graph_edit_enabled";
};

export function resolveWorkflowModeEnabled(
  raw: string | undefined,
  defaultValue = DEFAULT_WORKFLOW_MODE_ENABLED,
): boolean {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return defaultValue;
}

/**
 * Resolve the workflow-mode flag from the `settings` table first, then fall
 * back to the env var. Server-only: reads the shared SQLite database.
 */
export function resolveWorkflowModeServer(): boolean {
  const stored = getSetting(WORKFLOW_MODE_SETTING_KEY);
  if (stored !== null) return resolveWorkflowModeEnabled(stored);
  return resolveWorkflowModeEnabled(
    process.env.OPENCODE_WEBUI_WORKFLOW_MODE ?? process.env.NEXT_PUBLIC_OPENCODE_WEBUI_WORKFLOW_MODE,
  );
}

export function isWorkflowModeEnabled(): boolean {
  return resolveWorkflowModeServer();
}

function clientVisibleFlag(name: "MODE" | "GRAPH" | "GRAPH_EDIT"): string | undefined {
  return name === "MODE"
    ? process.env.OPENCODE_WEBUI_WORKFLOW_MODE ?? process.env.NEXT_PUBLIC_OPENCODE_WEBUI_WORKFLOW_MODE
    : name === "GRAPH"
      ? process.env.OPENCODE_WEBUI_WORKFLOW_GRAPH ?? process.env.NEXT_PUBLIC_OPENCODE_WEBUI_WORKFLOW_GRAPH
      : process.env.OPENCODE_WEBUI_WORKFLOW_GRAPH_EDIT ?? process.env.NEXT_PUBLIC_OPENCODE_WEBUI_WORKFLOW_GRAPH_EDIT;
}

export function resolveWorkflowGraphRollout(raw: {
  mode?: string;
  graph?: string;
  graphEdit?: string;
} = {
  mode: clientVisibleFlag("MODE"),
  graph: clientVisibleFlag("GRAPH"),
  graphEdit: clientVisibleFlag("GRAPH_EDIT"),
}): WorkflowGraphRollout {
  const workflowEnabled = resolveWorkflowModeEnabled(raw.mode);
  if (!workflowEnabled) {
    return { workflowEnabled, graphEnabled: false, graphEditEnabled: false, phase: "legacy", reason: "workflow_disabled" };
  }
  const graphEnabled = resolveWorkflowModeEnabled(raw.graph);
  if (!graphEnabled) {
    return { workflowEnabled, graphEnabled, graphEditEnabled: false, phase: "legacy", reason: "graph_disabled" };
  }
  const graphEditEnabled = resolveWorkflowModeEnabled(raw.graphEdit);
  return {
    workflowEnabled,
    graphEnabled,
    graphEditEnabled,
    phase: graphEditEnabled ? "graph_edit" : "graph_readonly",
    reason: graphEditEnabled ? "graph_edit_enabled" : "graph_readonly",
  };
}

export function isWorkflowGraphEnabled(): boolean {
  return resolveWorkflowGraphRollout().graphEnabled;
}

export function isWorkflowGraphEditEnabled(): boolean {
  return resolveWorkflowGraphRollout().graphEditEnabled;
}
