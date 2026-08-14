import { describe, expect, test } from "vitest";
import type { WorkflowExecutionSnapshot } from "./workflow-graph-types";
import { evaluateWorkflowGraphRuntime } from "./workflow-graph-runtime";

const snapshot = (overrides: Partial<WorkflowExecutionSnapshot> = {}): WorkflowExecutionSnapshot => ({
  schemaVersion: "workflow-execution-v2",
  graphSchemaVersion: "workflow-graph-v1",
  registryVersion: "workflow-node-registry-v1",
  sourceGraphId: "graph-runtime",
  sourceGraphRevision: 1,
  canonicalHash: "sha256:test",
  nodes: [
    { id: "implement", type: "opencode.implement_ui", typeVersion: 1, config: {}, resolvedPermissions: { write: true, subagent: false, browser: false }, resolvedExecutor: "opencode.implement_ui.v1" },
    { id: "review-a", type: "opencode.code_review", typeVersion: 1, config: {}, resolvedPermissions: { write: false, subagent: false, browser: false }, resolvedExecutor: "opencode.code_review.v1" },
    { id: "review-b", type: "opencode.visual_judge", typeVersion: 1, config: {}, resolvedPermissions: { write: false, subagent: false, browser: false }, resolvedExecutor: "opencode.visual_judge.v1" },
    { id: "gate", type: "control.review_gate", typeVersion: 1, config: {}, resolvedPermissions: { write: false, subagent: false, browser: false }, resolvedExecutor: "control.review_gate.v1" },
  ],
  edges: [
    { id: "i-a", source: "implement", sourceHandle: "result", target: "review-a", targetHandle: "input", kind: "dependency" },
    { id: "i-b", source: "implement", sourceHandle: "result", target: "review-b", targetHandle: "input", kind: "dependency" },
    { id: "a-g", source: "review-a", sourceHandle: "result", target: "gate", targetHandle: "code", kind: "control" },
    { id: "b-g", source: "review-b", sourceHandle: "result", target: "gate", targetHandle: "visual", kind: "control" },
    { id: "g-i", source: "gate", sourceHandle: "feedback", target: "implement", targetHandle: "feedback", kind: "feedback" },
  ],
  ...overrides,
});

describe("evaluateWorkflowGraphRuntime", () => {
  test("fans out reviewers and waits for the join", () => {
    const afterImplement = evaluateWorkflowGraphRuntime(snapshot(), [
      { nodeId: "implement", status: "succeeded", attemptNo: 1 },
    ]);
    expect(afterImplement.readyNodeIds).toEqual(["review-a", "review-b"]);

    const waiting = evaluateWorkflowGraphRuntime(snapshot(), [
      { nodeId: "implement", status: "succeeded", attemptNo: 1 },
      { nodeId: "review-a", status: "succeeded", attemptNo: 1 },
    ]);
    expect(waiting.waitingNodeIds).toContain("gate");
  });

  test("selects feedback and pauses failed or unsupported dependencies", () => {
    const feedback = evaluateWorkflowGraphRuntime(snapshot(), [
      { nodeId: "gate", status: "succeeded", attemptNo: 1, result: { decision: "return_to_implement" } },
    ]);
    expect(feedback.feedbackNodeIds).toContain("implement");
    const failed = evaluateWorkflowGraphRuntime(snapshot(), [
      { nodeId: "implement", status: "failed", attemptNo: 1 },
    ]);
    expect(failed.pauseReason).toBe("failed_dependency");
    const unsupported = evaluateWorkflowGraphRuntime(snapshot(), [
      { nodeId: "implement", status: "unsupported", attemptNo: 1 },
    ]);
    expect(unsupported.pauseReason).toBe("unsupported_dependency");
  });

  test("prevents parallel writable claims", () => {
    const graph = snapshot({
      nodes: [
        { id: "a", type: "opencode.implement_ui", typeVersion: 1, config: {}, resolvedPermissions: { write: true, subagent: false, browser: false }, resolvedExecutor: "opencode.implement_ui.v1" },
        { id: "b", type: "opencode.implement_ui", typeVersion: 1, config: {}, resolvedPermissions: { write: true, subagent: false, browser: false }, resolvedExecutor: "opencode.implement_ui.v1" },
      ],
      edges: [],
    });
    const result = evaluateWorkflowGraphRuntime(graph, []);
    expect(result.pauseReason).toBe("write_conflict");
    expect(result.readyNodeIds).toEqual([]);
    // Both writable nodes must be marked blocked: the scheduler pauses the run
    // only when blockedNodeIds contains the node key (BH-10), so an empty list
    // would silently stall the workflow instead of surfacing the conflict.
    expect([...result.blockedNodeIds].sort()).toEqual(["a", "b"]);
  });
});
