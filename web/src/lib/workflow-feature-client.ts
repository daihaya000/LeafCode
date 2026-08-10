/**
 * Browser-safe workflow rollout helpers.
 *
 * Keep this module free of the server-side settings/SQLite dependency. It is
 * imported by client components, so importing the server feature module here
 * would make better-sqlite3 (and Node's fs) part of the browser bundle.
 */
import {
  DEFAULT_WORKFLOW_GRAPH_EDIT_ENABLED,
  DEFAULT_WORKFLOW_GRAPH_ENABLED,
  DEFAULT_WORKFLOW_MODE_ENABLED,
  resolveWorkflowGraphRollout,
  resolveWorkflowModeEnabled,
  type WorkflowGraphRollout,
  type WorkflowGraphRolloutPhase,
} from "./workflow-feature-flags";

export {
  DEFAULT_WORKFLOW_GRAPH_EDIT_ENABLED,
  DEFAULT_WORKFLOW_GRAPH_ENABLED,
  DEFAULT_WORKFLOW_MODE_ENABLED,
  resolveWorkflowGraphRollout,
  resolveWorkflowModeEnabled,
};
export type { WorkflowGraphRollout, WorkflowGraphRolloutPhase };

function clientVisibleFlag(name: "MODE" | "GRAPH" | "GRAPH_EDIT"): string | undefined {
  return name === "MODE"
    ? process.env.NEXT_PUBLIC_OPENCODE_WEBUI_WORKFLOW_MODE
    : name === "GRAPH"
      ? process.env.NEXT_PUBLIC_OPENCODE_WEBUI_WORKFLOW_GRAPH
      : process.env.NEXT_PUBLIC_OPENCODE_WEBUI_WORKFLOW_GRAPH_EDIT;
}

export function isWorkflowGraphEnabled(): boolean {
  return resolveWorkflowGraphRollout({
    mode: clientVisibleFlag("MODE"),
    graph: clientVisibleFlag("GRAPH"),
    graphEdit: clientVisibleFlag("GRAPH_EDIT"),
  }).graphEnabled;
}

export function isWorkflowGraphEditEnabled(): boolean {
  return resolveWorkflowGraphRollout({
    mode: clientVisibleFlag("MODE"),
    graph: clientVisibleFlag("GRAPH"),
    graphEdit: clientVisibleFlag("GRAPH_EDIT"),
  }).graphEditEnabled;
}
