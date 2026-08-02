import {
  getDb,
  type WorkflowRunRow,
} from "./db";
import {
  synthesizeWorkflowGraph,
  type WorkflowGraphCompatOptions,
} from "./workflow-graph-compat";
import {
  validateWorkflowGraph,
} from "./workflow-graph-validation";
import type {
  WorkflowGraphDraft,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowGraphNodePresentation,
  WorkflowViewport,
} from "./workflow-graph-types";
import type { WorkflowDefinitionSnapshot } from "./workflow-types";

type WorkflowGraphRow = {
  id: string;
  workspace_id: string;
  schema_version: string;
  registry_version: string;
  graph_revision: number;
  viewport: string | null;
  created_at: string;
  updated_at: string;
};

type WorkflowGraphNodeRow = {
  graph_id: string;
  id: string;
  node_type: string;
  node_type_version: number;
  label: string;
  position_x: number;
  position_y: number;
  config: string;
  disabled: number;
  presentation: string | null;
  node_revision: number;
};

type WorkflowGraphEdgeRow = {
  graph_id: string;
  id: string;
  source_node_id: string;
  source_handle: string;
  target_node_id: string;
  target_handle: string;
  kind: WorkflowGraphEdge["kind"];
  label: string | null;
  edge_revision: number;
};

export class WorkflowGraphRepositoryError extends Error {
  constructor(
    message: string,
    readonly code:
      | "graph_not_found"
      | "invalid_graph"
      | "stored_graph_corrupt"
      | "legacy_definition_corrupt",
  ) {
    super(message);
    this.name = "WorkflowGraphRepositoryError";
  }
}

function parseObject(value: string, context: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new WorkflowGraphRepositoryError(
      `Stored Graph ${context} is not valid JSON object data`,
      "stored_graph_corrupt",
    );
  }
}

function parsePresentation(value: string | null): WorkflowGraphNodePresentation | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const raw = parsed as Record<string, unknown>;
    const presentation: WorkflowGraphNodePresentation = {};
    if (typeof raw.width === "number" && Number.isFinite(raw.width) && raw.width > 0) {
      presentation.width = raw.width;
    }
    if (typeof raw.collapsed === "boolean") presentation.collapsed = raw.collapsed;
    return Object.keys(presentation).length ? presentation : undefined;
  } catch {
    return undefined;
  }
}

function parseViewport(value: string | null): WorkflowViewport | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const raw = parsed as Record<string, unknown>;
    if (
      typeof raw.x !== "number" ||
      typeof raw.y !== "number" ||
      typeof raw.zoom !== "number" ||
      !Number.isFinite(raw.x) ||
      !Number.isFinite(raw.y) ||
      !Number.isFinite(raw.zoom)
    ) {
      return undefined;
    }
    return { x: raw.x, y: raw.y, zoom: raw.zoom };
  } catch {
    return undefined;
  }
}

function readGraphRowById(graphId: string): WorkflowGraphRow | undefined {
  return getDb()
    .prepare("SELECT * FROM workflow_graphs WHERE id = ?")
    .get(graphId) as WorkflowGraphRow | undefined;
}

function readGraphRowByWorkspace(workspaceId: string): WorkflowGraphRow | undefined {
  return getDb()
    .prepare("SELECT * FROM workflow_graphs WHERE workspace_id = ?")
    .get(workspaceId) as WorkflowGraphRow | undefined;
}

function toDraft(row: WorkflowGraphRow): WorkflowGraphDraft {
  const database = getDb();
  const nodeRows = database
    .prepare(
      `SELECT * FROM workflow_graph_nodes
       WHERE graph_id = ?
       ORDER BY rowid ASC`,
    )
    .all(row.id) as WorkflowGraphNodeRow[];
  const edgeRows = database
    .prepare(
      `SELECT * FROM workflow_graph_edges
       WHERE graph_id = ?
       ORDER BY rowid ASC`,
    )
    .all(row.id) as WorkflowGraphEdgeRow[];

  const nodes: WorkflowGraphNode[] = nodeRows.map((node) => ({
    id: node.id,
    type: node.node_type,
    typeVersion: node.node_type_version,
    label: node.label,
    position: { x: node.position_x, y: node.position_y },
    config: parseObject(node.config, `node ${node.id} config`),
    disabled: node.disabled === 1,
    ...(parsePresentation(node.presentation)
      ? { presentation: parsePresentation(node.presentation) }
      : {}),
  }));
  const edges: WorkflowGraphEdge[] = edgeRows.map((edge) => ({
    id: edge.id,
    source: edge.source_node_id,
    sourceHandle: edge.source_handle,
    target: edge.target_node_id,
    targetHandle: edge.target_handle,
    kind: edge.kind,
    ...(edge.label !== null ? { label: edge.label } : {}),
  }));
  const graph: WorkflowGraphDraft = {
    id: row.id,
    workspaceId: row.workspace_id,
    schemaVersion: row.schema_version as WorkflowGraphDraft["schemaVersion"],
    graphRevision: row.graph_revision,
    registryVersion: row.registry_version,
    nodes,
    edges,
    ...(parseViewport(row.viewport) ? { viewport: parseViewport(row.viewport) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const validation = validateWorkflowGraph(graph);
  if (!validation.valid) {
    throw new WorkflowGraphRepositoryError(
      `Stored Graph ${row.id} failed validation: ${validation.errors
        .map((entry) => entry.code)
        .join(", ")}`,
      "stored_graph_corrupt",
    );
  }
  return graph;
}

function validateForWrite(graph: WorkflowGraphDraft): void {
  const validation = validateWorkflowGraph(graph);
  if (!validation.valid) {
    throw new WorkflowGraphRepositoryError(
      `Graph ${graph.id} failed validation: ${validation.errors
        .map((entry) => entry.code)
        .join(", ")}`,
      "invalid_graph",
    );
  }
}

function insertGraphAggregate(graph: WorkflowGraphDraft, ignoreConflict = false): boolean {
  validateForWrite(graph);
  const database = getDb();
  const transaction = database.transaction(() => {
    const graphInsert = database
      .prepare(
        `INSERT ${ignoreConflict ? "OR IGNORE " : ""}INTO workflow_graphs
         (id, workspace_id, schema_version, registry_version, graph_revision, viewport, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        graph.id,
        graph.workspaceId,
        graph.schemaVersion,
        graph.registryVersion,
        graph.graphRevision,
        graph.viewport ? JSON.stringify(graph.viewport) : null,
        graph.createdAt,
        graph.updatedAt,
      );
    if (graphInsert.changes === 0) return false;

    const insertNode = database.prepare(
      `INSERT INTO workflow_graph_nodes
       (graph_id, id, node_type, node_type_version, label, position_x, position_y, config, disabled, presentation, node_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const node of graph.nodes) {
      insertNode.run(
        graph.id,
        node.id,
        node.type,
        node.typeVersion,
        node.label,
        node.position.x,
        node.position.y,
        JSON.stringify(node.config),
        node.disabled ? 1 : 0,
        node.presentation ? JSON.stringify(node.presentation) : null,
        1,
      );
    }
    const insertEdge = database.prepare(
      `INSERT INTO workflow_graph_edges
       (graph_id, id, source_node_id, source_handle, target_node_id, target_handle, kind, label, edge_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const edge of graph.edges) {
      insertEdge.run(
        graph.id,
        edge.id,
        edge.source,
        edge.sourceHandle,
        edge.target,
        edge.targetHandle,
        edge.kind,
        edge.label ?? null,
        1,
      );
    }
    return true;
  });
  return transaction() as boolean;
}

export function readWorkflowGraph(graphId: string): WorkflowGraphDraft | null {
  const row = readGraphRowById(graphId);
  return row ? toDraft(row) : null;
}

export function readWorkflowGraphByWorkspace(workspaceId: string): WorkflowGraphDraft | null {
  const row = readGraphRowByWorkspace(workspaceId);
  return row ? toDraft(row) : null;
}

export function materializeWorkflowGraph(graph: WorkflowGraphDraft): WorkflowGraphDraft {
  insertGraphAggregate(graph);
  return toDraft(readGraphRowById(graph.id) as WorkflowGraphRow);
}

function latestWorkflowRun(workspaceId: string): WorkflowRunRow | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM workflow_runs
       WHERE workspace_id = ?
       ORDER BY CASE WHEN status IN ('completed', 'failed', 'stopped', 'detached') THEN 1 ELSE 0 END,
                 updated_at DESC
       LIMIT 1`,
    )
    .get(workspaceId) as WorkflowRunRow | undefined;
}

function parseLegacyDefinition(run: WorkflowRunRow): WorkflowDefinitionSnapshot {
  try {
    const parsed: unknown = JSON.parse(run.definition_snapshot);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as WorkflowDefinitionSnapshot;
  } catch {
    throw new WorkflowGraphRepositoryError(
      `Legacy Workflow Run ${run.id} contains invalid definition snapshot`,
      "legacy_definition_corrupt",
    );
  }
}

export function getOrMaterializeWorkflowGraph(
  workspaceId: string,
  options: Pick<WorkflowGraphCompatOptions, "registryVersion"> = {},
): WorkflowGraphDraft | null {
  const existing = readWorkflowGraphByWorkspace(workspaceId);
  if (existing) return existing;
  const run = latestWorkflowRun(workspaceId);
  if (!run) return null;

  const graph = synthesizeWorkflowGraph(parseLegacyDefinition(run), {
    id: `workflow-graph:${workspaceId}`,
    workspaceId,
    graphRevision: 1,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    ...options,
  });
  insertGraphAggregate(graph, true);
  const materialized = readWorkflowGraphByWorkspace(workspaceId);
  if (!materialized) {
    throw new WorkflowGraphRepositoryError(
      `Graph for workspace ${workspaceId} could not be materialized`,
      "graph_not_found",
    );
  }
  return materialized;
}

export const materializeLegacyWorkflowGraph = getOrMaterializeWorkflowGraph;
