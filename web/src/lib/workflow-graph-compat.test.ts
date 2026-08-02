import { describe, expect, test } from "vitest";
import {
  WORKFLOW_COMPAT_GATE_NODE_ID,
  WorkflowGraphCompatError,
  createWorkflowGraphCompat,
  synthesizeWorkflowGraph,
} from "./workflow-graph-compat";
import { validateWorkflowGraph } from "./workflow-graph-validation";
import { createWorkflowDefinitionSnapshot } from "./workflow-types";

const metadata = {
  id: "graph-task-1",
  workspaceId: "workspace-1",
  graphRevision: 7,
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T01:00:00.000Z",
};

describe("synthesizeWorkflowGraph", () => {
  test("creates a valid stable four-node, five-edge compatibility graph", () => {
    const graph = synthesizeWorkflowGraph(
      createWorkflowDefinitionSnapshot(),
      metadata,
    );

    expect(graph).toMatchObject({
      id: metadata.id,
      workspaceId: metadata.workspaceId,
      schemaVersion: "workflow-graph-v1",
      graphRevision: metadata.graphRevision,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    });
    expect(graph.nodes.map((node) => node.id)).toEqual([
      "implement_ui",
      "code_review",
      "visual_judge",
      WORKFLOW_COMPAT_GATE_NODE_ID,
    ]);
    expect(graph.nodes.map((node) => node.type)).toEqual([
      "opencode.implement_ui",
      "opencode.code_review",
      "opencode.visual_judge",
      "control.review_gate",
    ]);
    expect(graph.edges).toHaveLength(5);
    expect(graph.edges.map((edge) => `${edge.source}->${edge.target}:${edge.kind}`)).toEqual([
      "implement_ui->code_review:dependency",
      "implement_ui->visual_judge:dependency",
      "code_review->review_gate:control",
      "visual_judge->review_gate:control",
      "review_gate->implement_ui:feedback",
    ]);
    expect(validateWorkflowGraph(graph)).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  test("keeps operational node IDs and definition config while adding a server gate", () => {
    const definition = createWorkflowDefinitionSnapshot();
    definition.nodes[0].label = "Build the UI";
    definition.nodes[0].config.instructions = "custom instructions";

    const graph = createWorkflowGraphCompat(definition, metadata);
    expect(graph.nodes[0]).toMatchObject({
      id: "implement_ui",
      label: "Build the UI",
      config: { instructions: "custom instructions" },
      disabled: false,
    });
    expect(graph.nodes[3]).toMatchObject({
      id: WORKFLOW_COMPAT_GATE_NODE_ID,
      type: "control.review_gate",
      typeVersion: 1,
      config: {},
    });
    expect(graph.edges[4]).toMatchObject({
      source: WORKFLOW_COMPAT_GATE_NODE_ID,
      sourceHandle: "feedback",
      target: "implement_ui",
      targetHandle: "feedback",
      kind: "feedback",
      label: "blocking_findings",
    });
  });

  test("is deterministic when legacy arrays are reordered", () => {
    const original = createWorkflowDefinitionSnapshot();
    const reordered = createWorkflowDefinitionSnapshot();
    reordered.nodes.reverse();
    reordered.edges.reverse();

    const first = synthesizeWorkflowGraph(original, metadata);
    const second = synthesizeWorkflowGraph(reordered, metadata);
    expect(second).toEqual(first);
  });

  test("does not share mutable config or position objects with the legacy definition", () => {
    const definition = createWorkflowDefinitionSnapshot();
    const graph = synthesizeWorkflowGraph(definition, metadata);

    graph.nodes[0].config.instructions = "changed in graph";
    graph.nodes[0].position.x = 999;
    expect(definition.nodes[0].config.instructions).not.toBe("changed in graph");
    expect(graph.nodes[0].position.x).not.toBe(0);
    expect(synthesizeWorkflowGraph(definition, metadata).nodes[0].position.x).toBe(0);
  });

  test("uses deterministic read-only metadata defaults when no persistence context is supplied", () => {
    const graph = synthesizeWorkflowGraph(createWorkflowDefinitionSnapshot());
    expect(graph).toMatchObject({
      id: "compat:ui_implementation_review",
      workspaceId: "compat",
      graphRevision: 1,
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
    });
  });
});

describe("legacy definition compatibility checks", () => {
  test.each([
    [
      "missing node",
      (definition: ReturnType<typeof createWorkflowDefinitionSnapshot>) => {
        definition.nodes = definition.nodes.filter((node) => node.key !== "visual_judge");
      },
      "missing_node",
    ],
    [
      "wrong template",
      (definition: ReturnType<typeof createWorkflowDefinitionSnapshot>) => {
        definition.templateKey = "other_template" as typeof definition.templateKey;
      },
      "unsupported_template",
    ],
    [
      "wrong edge topology",
      (definition: ReturnType<typeof createWorkflowDefinitionSnapshot>) => {
        definition.edges[0].condition = "blocking_findings";
      },
      "invalid_edge_topology",
    ],
  ])("rejects %s", (_label, mutate, code) => {
    const definition = createWorkflowDefinitionSnapshot();
    mutate(definition);

    try {
      synthesizeWorkflowGraph(definition, metadata);
      throw new Error("expected compatibility error");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowGraphCompatError);
      expect((error as WorkflowGraphCompatError).code).toBe(code);
    }
  });
});
