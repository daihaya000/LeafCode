import type { WorkflowExecutionSnapshot } from "./workflow-graph-types";

export type WorkflowRuntimeStatus =
  | "pending"
  | "ready"
  | "creating_session"
  | "dispatching"
  | "running"
  | "succeeded"
  | "failed"
  | "paused"
  | "unsupported";

export type WorkflowRuntimeNodeState = {
  nodeId: string;
  status: WorkflowRuntimeStatus | string;
  attemptNo: number;
  result?: unknown;
};

export type WorkflowRuntimeEvaluation = {
  readyNodeIds: string[];
  waitingNodeIds: string[];
  blockedNodeIds: string[];
  feedbackNodeIds: string[];
  terminal: boolean;
  pauseReason?: "failed_dependency" | "unsupported_dependency" | "write_conflict";
};

function isSuccess(state: WorkflowRuntimeNodeState | undefined): boolean {
  return state?.status === "succeeded" || state?.status === "completed";
}

function isUnsupported(state: WorkflowRuntimeNodeState | undefined): boolean {
  return state?.status === "unsupported";
}

function feedbackSelected(state: WorkflowRuntimeNodeState | undefined): boolean {
  const result = state?.result;
  return Boolean(result && typeof result === "object" && (result as { decision?: unknown }).decision === "return_to_implement");
}

export function evaluateWorkflowGraphRuntime(
  snapshot: WorkflowExecutionSnapshot,
  states: readonly WorkflowRuntimeNodeState[],
): WorkflowRuntimeEvaluation {
  const stateById = new Map(states.map((state) => [state.nodeId, state]));
  const incoming = new Map<string, typeof snapshot.edges>();
  for (const node of snapshot.nodes) incoming.set(node.id, []);
  for (const edge of snapshot.edges) {
    incoming.get(edge.target)?.push(edge);
  }

  const readyNodeIds: string[] = [];
  const waitingNodeIds: string[] = [];
  const blockedNodeIds: string[] = [];
  const feedbackNodeIds: string[] = [];
  let pauseReason: WorkflowRuntimeEvaluation["pauseReason"];

  for (const node of snapshot.nodes) {
    const current = stateById.get(node.id);
    if (current && ["succeeded", "completed", "running", "dispatching", "creating_session"].includes(current.status)) continue;
    const dependencies = (incoming.get(node.id) ?? []).filter((edge) => edge.kind !== "feedback");
    const feedback = (incoming.get(node.id) ?? []).filter((edge) => edge.kind === "feedback");
    if (feedback.some((edge) => feedbackSelected(stateById.get(edge.source)))) {
      feedbackNodeIds.push(node.id);
      readyNodeIds.push(node.id);
      continue;
    }
    if (dependencies.some((edge) => isUnsupported(stateById.get(edge.source)))) {
      blockedNodeIds.push(node.id);
      pauseReason ??= "unsupported_dependency";
      continue;
    }
    if (dependencies.some((edge) => ["failed", "paused"].includes(stateById.get(edge.source)?.status ?? ""))) {
      blockedNodeIds.push(node.id);
      pauseReason ??= "failed_dependency";
      continue;
    }
    if (dependencies.every((edge) => isSuccess(stateById.get(edge.source)))) {
      readyNodeIds.push(node.id);
    } else {
      waitingNodeIds.push(node.id);
    }
  }

  const writableReady = snapshot.nodes.filter((node) => readyNodeIds.includes(node.id) && node.resolvedPermissions.write);
  if (writableReady.length > 1) {
    // Two writable nodes became ready at once. Drop them all from the ready
    // set AND mark them blocked with a reason so the scheduler pauses the run
    // with `write_conflict` instead of silently skipping them forever.
    const conflicted = new Set(writableReady.map((node) => node.id));
    readyNodeIds.splice(0, readyNodeIds.length, ...readyNodeIds.filter((id) => !conflicted.has(id)));
    for (const node of writableReady) blockedNodeIds.push(node.id);
    pauseReason = "write_conflict";
  }
  const terminal = snapshot.nodes
    .filter((node) => !snapshot.edges.some((edge) => edge.source === node.id && edge.kind !== "feedback"))
    .every((node) => isSuccess(stateById.get(node.id)));
  return { readyNodeIds, waitingNodeIds, blockedNodeIds, feedbackNodeIds, terminal, ...(pauseReason ? { pauseReason } : {}) };
}

export function runtimeStatesFromSnapshotRows(rows: readonly WorkflowRuntimeNodeState[]): WorkflowRuntimeNodeState[] {
  return rows.map((row) => ({ ...row }));
}
