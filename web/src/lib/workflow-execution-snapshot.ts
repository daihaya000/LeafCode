import { createHash } from "node:crypto";
import { WORKFLOW_NODE_REGISTRY } from "./workflow-node-registry";
import { canonicalJson } from "./workflow-prompt";
import { validateWorkflowGraph } from "./workflow-graph-validation";
import type {
  WorkflowExecutionNode,
  WorkflowExecutionSnapshot,
  WorkflowGraphDraft,
  WorkflowGraphEdge,
  WorkflowGraphNode,
} from "./workflow-graph-types";
import type { WorkflowNodePermissions } from "./workflow-types";

export class WorkflowExecutionSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowExecutionSnapshotError";
  }
}

function semanticEdge(edge: WorkflowGraphEdge): WorkflowGraphEdge {
  const meaning = { ...edge };
  delete meaning.animated;
  return meaning;
}

function resolvedPermissions(node: WorkflowGraphNode, ceiling: WorkflowNodePermissions): WorkflowNodePermissions {
  const requested = (node.config.permissions ?? {}) as Partial<WorkflowNodePermissions>;
  return {
    write: requested.write === true && ceiling.write,
    subagent: requested.subagent === true && ceiling.subagent,
    browser: requested.browser === true && ceiling.browser,
  };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

export function createWorkflowExecutionSnapshot(graph: WorkflowGraphDraft): WorkflowExecutionSnapshot {
  const validation = validateWorkflowGraph(graph);
  if (!validation.valid) {
    throw new WorkflowExecutionSnapshotError(
      `Graph cannot be published: ${validation.errors.map((error) => error.code).join(", ")}`,
    );
  }
  const nodes: WorkflowExecutionNode[] = graph.nodes.map((node) => {
    const definition = WORKFLOW_NODE_REGISTRY.get(node.type, node.typeVersion);
    if (!definition) throw new WorkflowExecutionSnapshotError(`Unknown Node ${node.type}@${node.typeVersion}`);
    return {
      id: node.id,
      type: node.type,
      typeVersion: node.typeVersion,
      config: structuredClone(node.config),
      resolvedPermissions: resolvedPermissions(node, definition.permissionCeiling),
      resolvedExecutor: definition.executorKey,
    };
  });
  const edges = graph.edges.map(semanticEdge);
  const semantic = {
    schemaVersion: "workflow-execution-v2" as const,
    graphSchemaVersion: graph.schemaVersion,
    registryVersion: graph.registryVersion,
    nodes,
    edges,
  };
  const canonicalHash = `sha256:${createHash("sha256").update(canonicalJson(semantic), "utf8").digest("hex")}`;
  const presentation = {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      position: { ...node.position },
      ...(node.presentation ? { presentation: { ...node.presentation } } : {}),
    })),
    ...(graph.viewport ? { viewport: { ...graph.viewport } } : {}),
  };
  return freeze({
    ...semantic,
    sourceGraphId: graph.id,
    sourceGraphRevision: graph.graphRevision,
    canonicalHash,
    presentation,
  });
}
