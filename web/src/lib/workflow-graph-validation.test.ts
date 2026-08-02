import { describe, expect, test } from "vitest";
import {
  WorkflowNodeRegistry,
  WORKFLOW_NODE_REGISTRY,
  WORKFLOW_NODE_REGISTRY_VERSION,
  getDefaultWorkflowNodeConfig,
  type WorkflowNodeRegistryDefinition,
} from "./workflow-node-registry";
import {
  WORKFLOW_GRAPH_LIMITS,
  classifyWorkflowGraphNodeSupport,
  validateWorkflowGraph,
  validateWorkflowGraphForExecution,
  validateWorkflowNodeResult,
} from "./workflow-graph-validation";
import {
  WORKFLOW_GRAPH_SCHEMA_VERSION,
  type WorkflowGraphDraft,
  type WorkflowGraphNode,
} from "./workflow-graph-types";

function defaultConfig(type: string) {
  return getDefaultWorkflowNodeConfig(WORKFLOW_NODE_REGISTRY.get(type, 1)!)!;
}

function node(
  id: string,
  type: string,
  config: Record<string, unknown>,
  x: number,
): WorkflowGraphNode {
  return {
    id,
    type,
    typeVersion: 1,
    label: id,
    position: { x, y: 0 },
    config,
    disabled: false,
  };
}

function validGraph(): WorkflowGraphDraft {
  return {
    id: "graph-1",
    workspaceId: "workspace-1",
    schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
    graphRevision: 1,
    registryVersion: WORKFLOW_NODE_REGISTRY_VERSION,
    nodes: [
      node("implement_ui", "opencode.implement_ui", defaultConfig("opencode.implement_ui"), 0),
      node("code_review", "opencode.code_review", defaultConfig("opencode.code_review"), 300),
      node("visual_judge", "opencode.visual_judge", defaultConfig("opencode.visual_judge"), 300),
      node("review_gate", "control.review_gate", {}, 600),
    ],
    edges: [
      {
        id: "implement-code",
        source: "implement_ui",
        sourceHandle: "result",
        target: "code_review",
        targetHandle: "implementation",
        kind: "dependency",
      },
      {
        id: "implement-visual",
        source: "implement_ui",
        sourceHandle: "result",
        target: "visual_judge",
        targetHandle: "implementation",
        kind: "dependency",
      },
      {
        id: "code-gate",
        source: "code_review",
        sourceHandle: "result",
        target: "review_gate",
        targetHandle: "code_review",
        kind: "control",
      },
      {
        id: "visual-gate",
        source: "visual_judge",
        sourceHandle: "result",
        target: "review_gate",
        targetHandle: "visual_judge",
        kind: "control",
      },
      {
        id: "gate-feedback",
        source: "review_gate",
        sourceHandle: "feedback",
        target: "implement_ui",
        targetHandle: "feedback",
        kind: "feedback",
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
}

function issueCodes(graph: WorkflowGraphDraft) {
  return validateWorkflowGraph(graph).errors.map((entry) => entry.code);
}

function customDefinition(
  type: string,
  category: WorkflowNodeRegistryDefinition["category"] = "test",
): WorkflowNodeRegistryDefinition {
  return {
    type,
    version: 1,
    displayName: type,
    description: type,
    category,
    runtime: "server_control",
    userAddable: false,
    inputs: [
      {
        id: "in",
        label: "In",
        dataType: "test.value",
        required: false,
        multiple: true,
        edgeKinds: ["dependency", "feedback"],
      },
    ],
    outputs: [
      {
        id: "out",
        label: "Out",
        dataType: "test.value",
        required: false,
        multiple: true,
        edgeKinds: ["dependency", "feedback"],
      },
    ],
    configSchema: { type: "object", additionalProperties: false },
    resultSchema: { type: "object" },
    permissionCeiling: { write: false, subagent: false, browser: false },
    executorKey: "test.executor",
    rendererKey: "test.renderer",
    resultParserKey: "review-gate-result-v1",
  };
}

function customRegistry(...definitions: WorkflowNodeRegistryDefinition[]) {
  return new WorkflowNodeRegistry("test-registry-v1", definitions, {
    executorKeys: new Set(["test.executor"]),
    rendererKeys: new Set(["test.renderer"]),
  });
}

describe("validateWorkflowGraph", () => {
  test("accepts the Registry v1 four-node graph and approved Gate feedback", () => {
    const result = validateWorkflowGraph(validGraph());
    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  test("classifies unknown types for display but rejects execution", () => {
    const graph = validGraph();
    graph.nodes[0].typeVersion = 99;

    expect(classifyWorkflowGraphNodeSupport(graph.nodes)[0]).toMatchObject({
      nodeId: "implement_ui",
      supported: false,
      reason: "unknown_type_or_version",
    });
    expect(
      validateWorkflowGraphForExecution(graph).errors.map((entry) => entry.code),
    ).toContain("unsupported_node_type");
  });

  test("validates config with Ajv and enforces permission ceilings", () => {
    const unknownField = validGraph();
    unknownField.nodes[0].config.unexpected = true;
    expect(issueCodes(unknownField)).toContain("invalid_node_config");

    const ceiling = validGraph();
    const permissions = ceiling.nodes[1].config.permissions as Record<string, boolean>;
    permissions.write = true;
    expect(issueCodes(ceiling)).toContain("permission_ceiling_exceeded");
  });

  test("validates runtime results against the Registry result schema", () => {
    expect(
      validateWorkflowNodeResult("opencode.implement_ui", 1, {
        status: "completed",
        summary: "done",
        evidence: ["tests"],
      }),
    ).toMatchObject({ supported: true, valid: true, errors: [] });
    expect(
      validateWorkflowNodeResult("opencode.code_review", 1, {
        verdict: "pass",
        summary: "ok",
        evidence: [],
        findings: [],
        unexpected: true,
      }).valid,
    ).toBe(false);
    expect(validateWorkflowNodeResult("future.node", 1, {}).supported).toBe(false);
  });

  test("rejects duplicate IDs, self edges, invalid handles, and duplicate connections", () => {
    const duplicateNode = validGraph();
    duplicateNode.nodes.push(structuredClone(duplicateNode.nodes[0]));
    expect(issueCodes(duplicateNode)).toContain("duplicate_node_id");

    const selfEdge = validGraph();
    selfEdge.edges.push({
      id: "self",
      source: "implement_ui",
      sourceHandle: "result",
      target: "implement_ui",
      targetHandle: "feedback",
      kind: "feedback",
    });
    expect(issueCodes(selfEdge)).toContain("self_edge");

    const invalidHandle = validGraph();
    invalidHandle.edges[0].sourceHandle = "missing";
    expect(issueCodes(invalidHandle)).toContain("missing_source_port");

    const duplicateConnection = validGraph();
    duplicateConnection.edges.push({
      ...structuredClone(duplicateConnection.edges[0]),
      id: "implement-code-2",
    });
    expect(issueCodes(duplicateConnection)).toContain("duplicate_port_connection");
  });

  test("rejects missing required inputs and incompatible ports", () => {
    const missingInput = validGraph();
    missingInput.edges = missingInput.edges.filter((edge) => edge.id !== "implement-code");
    expect(issueCodes(missingInput)).toContain("missing_required_input");

    const incompatible = validGraph();
    incompatible.edges[0].target = "review_gate";
    incompatible.edges[0].targetHandle = "code_review";
    expect(issueCodes(incompatible)).toContain("incompatible_port");
  });

  test("rejects ordinary cycles while allowing only Control-origin feedback", () => {
    const registry = customRegistry(customDefinition("test.a"), customDefinition("test.b"));
    const graph: WorkflowGraphDraft = {
      ...validGraph(),
      registryVersion: registry.version,
      nodes: [node("a", "test.a", {}, 0), node("b", "test.b", {}, 100)],
      edges: [
        { id: "a-b", source: "a", sourceHandle: "out", target: "b", targetHandle: "in", kind: "dependency" },
        { id: "b-a", source: "b", sourceHandle: "out", target: "a", targetHandle: "in", kind: "dependency" },
      ],
    };
    expect(
      validateWorkflowGraph(graph, { registry }).errors.map((entry) => entry.code),
    ).toContain("dependency_cycle");

    graph.edges = [
      { id: "feedback", source: "a", sourceHandle: "out", target: "b", targetHandle: "in", kind: "feedback" },
    ];
    expect(
      validateWorkflowGraph(graph, { registry }).errors.map((entry) => entry.code),
    ).toContain("invalid_feedback_edge");
  });

  test("rejects write-capable nodes that are unordered in the DAG", () => {
    const graph = validGraph();
    graph.nodes = [
      graph.nodes[0],
      { ...structuredClone(graph.nodes[0]), id: "implement_ui_2", label: "Second implement" },
    ];
    graph.edges = [];
    expect(issueCodes(graph)).toContain("parallel_write_nodes");
  });

  test("enforces Node, Edge, config, Graph, position, and viewport limits", () => {
    const unknownNodes = (count: number): WorkflowGraphDraft => ({
      ...validGraph(),
      nodes: Array.from({ length: count }, (_, index) =>
        node(`unknown-${index}`, "future.node", {}, index),
      ),
      edges: [],
    });
    expect(
      validateWorkflowGraph(unknownNodes(WORKFLOW_GRAPH_LIMITS.maxNodes), {
        allowUnsupported: true,
      }).errors.map((entry) => entry.code),
    ).not.toContain("too_many_nodes");
    expect(
      validateWorkflowGraph(unknownNodes(WORKFLOW_GRAPH_LIMITS.maxNodes + 1), {
        allowUnsupported: true,
      }).errors.map((entry) => entry.code),
    ).toContain("too_many_nodes");

    const edgeBoundary = unknownNodes(2);
    edgeBoundary.edges = Array.from({ length: WORKFLOW_GRAPH_LIMITS.maxEdges }, (_, index) => ({
      id: `edge-${index}`,
      source: "unknown-0",
      sourceHandle: "out",
      target: "unknown-1",
      targetHandle: "in",
      kind: "dependency" as const,
    }));
    expect(
      validateWorkflowGraph(edgeBoundary, { allowUnsupported: true }).errors.map((entry) => entry.code),
    ).not.toContain("too_many_edges");
    edgeBoundary.edges.push({ ...edgeBoundary.edges[0], id: "edge-over-limit" });
    expect(
      validateWorkflowGraph(edgeBoundary, { allowUnsupported: true }).errors.map((entry) => entry.code),
    ).toContain("too_many_edges");

    const oversizedConfig = validGraph();
    oversizedConfig.nodes[0].config.instructions = "x".repeat(
      WORKFLOW_GRAPH_LIMITS.maxNodeConfigBytes + 1,
    );
    expect(issueCodes(oversizedConfig)).toContain("node_config_too_large");

    const oversizedGraph = validGraph();
    oversizedGraph.nodes[0].label = "x".repeat(WORKFLOW_GRAPH_LIMITS.maxGraphBytes + 1);
    expect(issueCodes(oversizedGraph)).toContain("graph_too_large");

    const invalidPosition = validGraph();
    invalidPosition.nodes[0].position.x = Number.POSITIVE_INFINITY;
    expect(issueCodes(invalidPosition)).toContain("invalid_position");

    const invalidViewport = validGraph();
    invalidViewport.viewport = { x: 0, y: 0, zoom: 2.1 };
    expect(issueCodes(invalidViewport)).toContain("invalid_viewport");
  });
});
