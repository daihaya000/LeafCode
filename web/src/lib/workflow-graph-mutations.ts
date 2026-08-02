import {
  readWorkflowGraphByWorkspace,
  updateWorkflowGraphCas,
  WorkflowGraphRepositoryError,
} from "./workflow-graph-repository";
import { validateWorkflowGraph } from "./workflow-graph-validation";
import type {
  WorkflowGraphDraft,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowGraphNodePresentation,
  WorkflowGraphPosition,
  WorkflowViewport,
} from "./workflow-graph-types";

export type WorkflowGraphOperation =
  | { op: "update_node_config"; nodeId: string; config: Record<string, unknown> }
  | { op: "update_node_presentation"; nodeId: string; presentation?: WorkflowGraphNodePresentation }
  | { op: "move_node"; nodeId: string; position: WorkflowGraphPosition }
  | { op: "set_node_disabled"; nodeId: string; disabled: boolean }
  | { op: "set_node_label"; nodeId: string; label: string }
  | { op: "set_viewport"; viewport?: WorkflowViewport }
  | { op: "add_node"; node: WorkflowGraphNode }
  | { op: "remove_node"; nodeId: string }
  | { op: "add_edge"; edge: WorkflowGraphEdge }
  | { op: "remove_edge"; edgeId: string };

export class WorkflowGraphMutationError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_operation" | "graph_not_found" | "revision_conflict" | "invalid_graph",
    readonly latestGraph?: WorkflowGraphDraft,
  ) {
    super(message);
    this.name = "WorkflowGraphMutationError";
  }
}

function requireNode(graph: WorkflowGraphDraft, nodeId: string): WorkflowGraphNode {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new WorkflowGraphMutationError(`Node ${nodeId} does not exist`, "invalid_operation");
  return node;
}

function cloneGraph(graph: WorkflowGraphDraft): WorkflowGraphDraft {
  return structuredClone(graph);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOperation(value: unknown): WorkflowGraphOperation {
  if (!isRecord(value) || typeof value.op !== "string") {
    throw new WorkflowGraphMutationError("Invalid Graph operation", "invalid_operation");
  }
  const hasString = (key: string): boolean => typeof value[key] === "string" && String(value[key]).length > 0;
  switch (value.op) {
    case "update_node_config":
      if (!hasString("nodeId") || !isRecord(value.config)) break;
      return value as unknown as WorkflowGraphOperation;
    case "update_node_presentation":
      if (!hasString("nodeId") || (value.presentation !== undefined && !isRecord(value.presentation))) break;
      return value as unknown as WorkflowGraphOperation;
    case "move_node":
      if (!hasString("nodeId") || !isRecord(value.position)) break;
      return value as unknown as WorkflowGraphOperation;
    case "set_node_disabled":
      if (!hasString("nodeId") || typeof value.disabled !== "boolean") break;
      return value as unknown as WorkflowGraphOperation;
    case "set_node_label":
      if (!hasString("nodeId") || typeof value.label !== "string") break;
      return value as unknown as WorkflowGraphOperation;
    case "set_viewport":
      if (value.viewport !== undefined && !isRecord(value.viewport)) break;
      return value as unknown as WorkflowGraphOperation;
    case "add_node":
      if (!isRecord(value.node)) break;
      if (typeof value.node.id !== "string" || value.node.id.length === 0) break;
      return value as unknown as WorkflowGraphOperation;
    case "remove_node":
      if (!hasString("nodeId")) break;
      return value as unknown as WorkflowGraphOperation;
    case "add_edge":
      if (!isRecord(value.edge)) break;
      if (typeof value.edge.id !== "string" || value.edge.id.length === 0) break;
      return value as unknown as WorkflowGraphOperation;
    case "remove_edge":
      if (!hasString("edgeId")) break;
      return value as unknown as WorkflowGraphOperation;
    default:
      break;
  }
  throw new WorkflowGraphMutationError(`Invalid Graph operation: ${String(value.op)}`, "invalid_operation");
}

function applyOperation(graph: WorkflowGraphDraft, operation: WorkflowGraphOperation): void {
  switch (operation.op) {
    case "update_node_config":
      requireNode(graph, operation.nodeId).config = operation.config;
      return;
    case "update_node_presentation": {
      const node = requireNode(graph, operation.nodeId);
      node.presentation = operation.presentation;
      return;
    }
    case "move_node":
      requireNode(graph, operation.nodeId).position = operation.position;
      return;
    case "set_node_disabled":
      requireNode(graph, operation.nodeId).disabled = operation.disabled;
      return;
    case "set_node_label":
      requireNode(graph, operation.nodeId).label = operation.label;
      return;
    case "set_viewport":
      graph.viewport = operation.viewport;
      return;
    case "add_node":
      if (graph.nodes.some((node) => node.id === operation.node.id)) {
        throw new WorkflowGraphMutationError(`Node ${operation.node.id} already exists`, "invalid_operation");
      }
      graph.nodes.push(operation.node);
      return;
    case "remove_node":
      requireNode(graph, operation.nodeId);
      graph.nodes = graph.nodes.filter((node) => node.id !== operation.nodeId);
      graph.edges = graph.edges.filter(
        (edge) => edge.source !== operation.nodeId && edge.target !== operation.nodeId,
      );
      return;
    case "add_edge":
      if (graph.edges.some((edge) => edge.id === operation.edge.id)) {
        throw new WorkflowGraphMutationError(`Edge ${operation.edge.id} already exists`, "invalid_operation");
      }
      graph.edges.push(operation.edge);
      return;
    case "remove_edge": {
      const before = graph.edges.length;
      graph.edges = graph.edges.filter((edge) => edge.id !== operation.edgeId);
      if (before === graph.edges.length) {
        throw new WorkflowGraphMutationError(`Edge ${operation.edgeId} does not exist`, "invalid_operation");
      }
      return;
    }
    default:
      throw new WorkflowGraphMutationError("Invalid Graph operation", "invalid_operation");
  }
}

export function updateWorkflowGraph(input: {
  workspaceId: string;
  expectedGraphRevision: unknown;
  operations: unknown;
}): WorkflowGraphDraft {
  if (
    typeof input.expectedGraphRevision !== "number" ||
    !Number.isInteger(input.expectedGraphRevision) ||
    input.expectedGraphRevision < 1
  ) {
    throw new WorkflowGraphMutationError("expectedGraphRevision is required", "invalid_operation");
  }
  if (!Array.isArray(input.operations) || input.operations.length === 0 || input.operations.length > 100) {
    throw new WorkflowGraphMutationError("operations must contain 1 to 100 items", "invalid_operation");
  }
  const current = readWorkflowGraphByWorkspace(input.workspaceId);
  if (!current) throw new WorkflowGraphMutationError("Workflow Graph not found", "graph_not_found");
  if (current.graphRevision !== input.expectedGraphRevision) {
    throw new WorkflowGraphMutationError("Workflow Graph revision conflict", "revision_conflict", current);
  }
  const next = cloneGraph(current);
  for (const operation of input.operations) applyOperation(next, parseOperation(operation));
  next.graphRevision = current.graphRevision + 1;
  next.updatedAt = new Date().toISOString();
  const validation = validateWorkflowGraph(next);
  if (!validation.valid) {
    throw new WorkflowGraphMutationError(
      `Graph mutation failed validation: ${validation.errors.map((error) => error.code).join(", ")}`,
      "invalid_graph",
    );
  }
  if (!updateWorkflowGraphCas(next, current.graphRevision)) {
    const latest = readWorkflowGraphByWorkspace(input.workspaceId) ?? undefined;
    throw new WorkflowGraphMutationError("Workflow Graph revision conflict", "revision_conflict", latest);
  }
  return next;
}

export function isGraphMutationError(error: unknown): error is WorkflowGraphMutationError {
  return error instanceof WorkflowGraphMutationError || error instanceof WorkflowGraphRepositoryError;
}
