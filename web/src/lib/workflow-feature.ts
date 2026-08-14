/**
 * Workflow execution is opt-in while the feature is being introduced. Keep
 * environment parsing in one server-side helper so API and scheduler gates
 * cannot drift.
 *
 * Resolution precedence (server-side):
 *   1. `settings` table row `workflow-mode` — the user-facing toggle from the
 *      Settings screen (source of truth once flipped).
 *   2. `LEAFCODE_WORKFLOW_MODE` / `NEXT_PUBLIC_LEAFCODE_WORKFLOW_MODE`
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
import {
  DEFAULT_WORKFLOW_GRAPH_EDIT_ENABLED,
  DEFAULT_WORKFLOW_GRAPH_ENABLED,
  DEFAULT_WORKFLOW_MODE_ENABLED,
  resolveWorkflowGraphRollout as resolveWorkflowGraphRolloutBase,
  resolveWorkflowModeEnabled,
  type WorkflowGraphRollout,
  type WorkflowGraphRolloutPhase,
} from "./workflow-feature-flags";

export {
  DEFAULT_WORKFLOW_GRAPH_EDIT_ENABLED,
  DEFAULT_WORKFLOW_GRAPH_ENABLED,
  DEFAULT_WORKFLOW_MODE_ENABLED,
  resolveWorkflowModeEnabled,
};
export type { WorkflowGraphRollout, WorkflowGraphRolloutPhase };

/** Server-side `settings` key mirrored in the settings route allowlist. */
export const WORKFLOW_MODE_SETTING_KEY = "workflow-mode";

/**
 * Resolve the workflow-mode flag from the `settings` table first, then fall
 * back to the env var. Server-only: reads the shared SQLite database.
 */
export function resolveWorkflowModeServer(): boolean {
  const stored = getSetting(WORKFLOW_MODE_SETTING_KEY);
  if (stored !== null) return resolveWorkflowModeEnabled(stored);
  return resolveWorkflowModeEnabled(
    process.env.LEAFCODE_WORKFLOW_MODE ?? process.env.NEXT_PUBLIC_LEAFCODE_WORKFLOW_MODE,
  );
}

export function isWorkflowModeEnabled(): boolean {
  return resolveWorkflowModeServer();
}

function clientVisibleFlag(name: "MODE" | "GRAPH" | "GRAPH_EDIT"): string | undefined {
  return name === "MODE"
    ? process.env.LEAFCODE_WORKFLOW_MODE ?? process.env.NEXT_PUBLIC_LEAFCODE_WORKFLOW_MODE
    : name === "GRAPH"
      ? process.env.LEAFCODE_WORKFLOW_GRAPH ?? process.env.NEXT_PUBLIC_LEAFCODE_WORKFLOW_GRAPH
      : process.env.LEAFCODE_WORKFLOW_GRAPH_EDIT ?? process.env.NEXT_PUBLIC_LEAFCODE_WORKFLOW_GRAPH_EDIT;
}

export function resolveWorkflowGraphRollout(raw: {
  mode?: string;
  graph?: string;
  graphEdit?: string;
} = {
  mode: clientVisibleFlag("MODE"),
  graph: clientVisibleFlag("GRAPH"),
  graphEdit: clientVisibleFlag("GRAPH_EDIT"),
}) {
  return resolveWorkflowGraphRolloutBase(raw);
}

export function isWorkflowGraphEnabled(): boolean {
  return resolveWorkflowGraphRollout().graphEnabled;
}

export function isWorkflowGraphEditEnabled(): boolean {
  return resolveWorkflowGraphRollout().graphEditEnabled;
}
