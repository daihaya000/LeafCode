import { WORKFLOW_EXECUTOR_KEYS } from "./workflow-node-registry";
import type { WorkflowExecutionSnapshot } from "./workflow-graph-types";
import type { WorkflowNodeKey } from "./workflow-types";

export type WorkflowExecutorRuntime = "opencode_session" | "server_control";

export type WorkflowExecutor = {
  key: string;
  runtime: WorkflowExecutorRuntime;
  resultParserKey: string;
};

export class WorkflowExecutorResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowExecutorResolutionError";
  }
}

const EXECUTORS: ReadonlyMap<string, WorkflowExecutor> = new Map(
  WORKFLOW_EXECUTOR_KEYS.map((key) => [
    key,
    {
      key,
      runtime: key.startsWith("control.") ? "server_control" : "opencode_session",
      resultParserKey: key.startsWith("control.") ? "review-gate-result-v1" : key.includes("implement") ? "implement-result-v1" : "review-result-v1",
    },
  ]),
);

export function resolveExecutor(key: string): WorkflowExecutor {
  const executor = EXECUTORS.get(key);
  if (!executor) throw new WorkflowExecutorResolutionError(`Unknown workflow executor ${key}`);
  return executor;
}

export function resolveSnapshotExecutor(
  snapshot: WorkflowExecutionSnapshot,
  nodeId: string,
): WorkflowExecutor {
  const node = snapshot.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new WorkflowExecutorResolutionError(`Snapshot Node ${nodeId} is missing`);
  return resolveExecutor(node.resolvedExecutor);
}

export function resolveLegacyExecutor(nodeKey: WorkflowNodeKey): WorkflowExecutor {
  const key = nodeKey === "implement_ui"
    ? "opencode.implement_ui.v1"
    : nodeKey === "code_review"
      ? "opencode.code_review.v1"
      : "opencode.visual_judge.v1";
  return resolveExecutor(key);
}

export function resolveLegacyControlExecutor(): WorkflowExecutor {
  return resolveExecutor("control.review_gate.v1");
}

export function executorRegistryKeys(): readonly string[] {
  return [...EXECUTORS.keys()];
}
