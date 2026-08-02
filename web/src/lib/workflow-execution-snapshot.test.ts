import { describe, expect, test } from "vitest";
import { createWorkflowGraphCompat } from "./workflow-graph-compat";
import { createWorkflowExecutionSnapshot } from "./workflow-execution-snapshot";
import { createWorkflowDefinitionSnapshot } from "./workflow-types";

function graph() {
  return createWorkflowGraphCompat(createWorkflowDefinitionSnapshot(), {
    id: "graph-snapshot",
    workspaceId: "ws-snapshot",
    graphRevision: 4,
  });
}

describe("createWorkflowExecutionSnapshot", () => {
  test("generates an immutable v2 snapshot with resolved executor and permissions", () => {
    const snapshot = createWorkflowExecutionSnapshot(graph());
    expect(snapshot.schemaVersion).toBe("workflow-execution-v2");
    expect(snapshot.nodes.find((node) => node.id === "review_gate")).toMatchObject({
      resolvedExecutor: "control.review_gate.v1",
      resolvedPermissions: { write: false, subagent: false, browser: false },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.nodes[0])).toBe(true);
  });

  test("excludes layout, viewport, presentation, and animated Edge state from semantic hash", () => {
    const base = graph();
    const layoutOnly = structuredClone(base);
    layoutOnly.graphRevision = 99;
    layoutOnly.viewport = { x: 100, y: 20, zoom: 1.25 };
    layoutOnly.nodes[0].position = { x: 999, y: 777 };
    layoutOnly.nodes[0].presentation = { collapsed: true, width: 280 };
    layoutOnly.edges[0].animated = true;
    expect(createWorkflowExecutionSnapshot(base).canonicalHash).toBe(
      createWorkflowExecutionSnapshot(layoutOnly).canonicalHash,
    );
    const semanticChange = structuredClone(base);
    semanticChange.nodes[0].config = { ...semanticChange.nodes[0].config, instructions: "changed" };
    expect(createWorkflowExecutionSnapshot(base).canonicalHash).not.toBe(
      createWorkflowExecutionSnapshot(semanticChange).canonicalHash,
    );
  });
});
