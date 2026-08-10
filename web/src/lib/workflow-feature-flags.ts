export const DEFAULT_WORKFLOW_MODE_ENABLED = false;
export const DEFAULT_WORKFLOW_GRAPH_ENABLED = false;
export const DEFAULT_WORKFLOW_GRAPH_EDIT_ENABLED = false;

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

export function resolveWorkflowGraphRollout(raw: {
  mode?: string;
  graph?: string;
  graphEdit?: string;
} = {}): WorkflowGraphRollout {
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
