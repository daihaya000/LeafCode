import { describe, expect, test } from "vitest";
import { createWorkflowGraphCompat } from "./workflow-graph-compat";
import { createWorkflowDefinitionSnapshot } from "./workflow-types";
import { layoutWorkflowGraph } from "./workflow-graph-layout";

const graph = createWorkflowGraphCompat(createWorkflowDefinitionSnapshot(), {
  id: "layout-test",
  workspaceId: "ws-layout",
});

describe("layoutWorkflowGraph", () => {
  test("creates deterministic LR coordinates and excludes feedback edges", () => {
    const withFeedback = structuredClone(graph);
    withFeedback.edges.push({
      id: "feedback-loop",
      source: "review_gate",
      sourceHandle: "feedback",
      target: "implement_ui",
      targetHandle: "input",
      kind: "feedback",
    });
    const first = layoutWorkflowGraph(withFeedback, "LR");
    const second = layoutWorkflowGraph(withFeedback, "LR");
    expect([...first.entries()]).toEqual([...second.entries()]);
    expect(first.get("implement_ui")?.x).toBeLessThan(first.get("review_gate")?.x ?? 0);
  });

  test("places the graph top-to-bottom for TB", () => {
    const positions = layoutWorkflowGraph(graph, "TB");
    expect(positions.get("implement_ui")?.y).toBeLessThan(positions.get("code_review")?.y ?? 0);
    expect(positions.get("review_gate")?.y).toBeGreaterThan(positions.get("code_review")?.y ?? 0);
  });
});
