import { describe, expect, test } from "vitest";
import { createWorkflowGraphCompat } from "./workflow-graph-compat";
import { toWorkflowGraphReactFlow } from "./workflow-graph-react-flow";
import { createWorkflowDefinitionSnapshot } from "./workflow-types";

const graph = createWorkflowGraphCompat(createWorkflowDefinitionSnapshot(), {
  id: "graph-1",
  workspaceId: "workspace-1",
});

describe("toWorkflowGraphReactFlow", () => {
  test("maps Graph DTO nodes and edges to read-only React Flow elements", () => {
    const result = toWorkflowGraphReactFlow(graph, [
      { nodeId: "implement_ui", status: "succeeded", attemptNo: 1 },
      { nodeId: "code_review", status: "running", attemptNo: 1, dispatchStatus: "awaiting_result" },
    ]);

    expect(result.nodes).toHaveLength(4);
    expect(result.edges).toHaveLength(5);
    expect(result.nodes[0]).toMatchObject({
      id: "implement_ui",
      type: "workflowGraphNode",
      draggable: false,
      connectable: false,
      data: { status: "succeeded", attemptNo: 1, unsupported: false },
    });
    expect(result.edges[0]).toMatchObject({
      type: "workflowGraphEdge",
      animated: true,
      data: { active: true },
    });
  });

  test("does not animate active edges when reduced motion is requested", () => {
    const result = toWorkflowGraphReactFlow(
      graph,
      [{ nodeId: "code_review", status: "running", attemptNo: 1 }],
      true,
    );
    expect(result.edges.find((edge) => edge.id === "implement_ui-to-code_review"))
      .toMatchObject({ animated: false, data: { active: true, reducedMotion: true } });
  });

  test("uses a top-to-bottom layout for narrow viewports", () => {
    const result = toWorkflowGraphReactFlow(graph, [], false, "TB");
    const positions = new Map(result.nodes.map((node) => [node.id, node.position]));
    expect(positions.get("implement_ui")?.y).toBeLessThan(positions.get("code_review")?.y ?? 0);
    expect(positions.get("code_review")?.y).toBe(positions.get("visual_judge")?.y);
    expect(positions.get("review_gate")?.y).toBeGreaterThan(positions.get("code_review")?.y ?? 0);
  });

  test("keeps unknown Registry nodes visible but marks them unsupported", () => {
    const unsupported = structuredClone(graph);
    unsupported.nodes[0].type = "future.node";
    unsupported.nodes[0].typeVersion = 99;
    const result = toWorkflowGraphReactFlow(unsupported);
    expect(result.nodes[0]).toMatchObject({
      id: "implement_ui",
      data: { status: "unsupported", unsupported: true },
    });
  });
});
