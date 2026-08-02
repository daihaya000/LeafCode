import Ajv, { type AnySchema, type ValidateFunction } from "ajv";
import {
  WORKFLOW_NODE_REGISTRY,
  type WorkflowNodeRegistry,
  type WorkflowNodeRegistryDefinition,
  type WorkflowPortDefinition,
} from "./workflow-node-registry";
import {
  WORKFLOW_GRAPH_SCHEMA_VERSION,
  type WorkflowGraphDraft,
  type WorkflowGraphEdge,
  type WorkflowGraphNode,
} from "./workflow-graph-types";

export const WORKFLOW_GRAPH_LIMITS = {
  maxNodes: 100,
  maxEdges: 300,
  maxNodeConfigBytes: 64 * 1024,
  maxGraphBytes: 2 * 1024 * 1024,
  minZoom: 0.25,
  maxZoom: 2,
  minPosition: -100_000,
  maxPosition: 100_000,
} as const;

export type WorkflowGraphValidationCode =
  | "invalid_schema_version"
  | "invalid_registry_version"
  | "graph_too_large"
  | "too_many_nodes"
  | "too_many_edges"
  | "duplicate_node_id"
  | "duplicate_edge_id"
  | "invalid_node_id"
  | "invalid_node_shape"
  | "invalid_edge_id"
  | "invalid_edge_shape"
  | "unsupported_node_type"
  | "invalid_node_config"
  | "node_config_too_large"
  | "permission_ceiling_exceeded"
  | "invalid_position"
  | "invalid_viewport"
  | "missing_source_node"
  | "missing_target_node"
  | "missing_source_port"
  | "missing_target_port"
  | "incompatible_port"
  | "incompatible_edge_kind"
  | "duplicate_port_connection"
  | "self_edge"
  | "invalid_feedback_edge"
  | "dependency_cycle"
  | "missing_required_input"
  | "unreachable_node"
  | "missing_terminal_path"
  | "parallel_write_nodes";

export type WorkflowGraphValidationIssue = {
  code: WorkflowGraphValidationCode;
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
  path?: string;
};

export type WorkflowGraphValidationResult = {
  valid: boolean;
  errors: WorkflowGraphValidationIssue[];
  warnings: WorkflowGraphValidationIssue[];
};

export type WorkflowGraphNodeSupport = {
  nodeId: string;
  supported: boolean;
  reason?: "unknown_type_or_version";
  definition?: WorkflowNodeRegistryDefinition;
};

export type WorkflowNodeResultValidation = {
  supported: boolean;
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
};

const ajv = new Ajv({ allErrors: true, strict: true });
const compiledSchemas = new WeakMap<object, ValidateFunction>();
const edgeKinds = new Set(["dependency", "success", "feedback", "control"]);

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSchemaValidator(schema: AnySchema): ValidateFunction {
  if (typeof schema !== "object" || schema === null) return ajv.compile(schema);
  const cached = compiledSchemas.get(schema);
  if (cached) return cached;
  const compiled = ajv.compile(schema);
  compiledSchemas.set(schema, compiled);
  return compiled;
}

function portById(
  ports: readonly WorkflowPortDefinition[],
  id: string,
): WorkflowPortDefinition | undefined {
  return ports.find((port) => port.id === id);
}

function issue(
  code: WorkflowGraphValidationCode,
  message: string,
  fields: Pick<WorkflowGraphValidationIssue, "nodeId" | "edgeId" | "path"> = {},
  severity: WorkflowGraphValidationIssue["severity"] = "error",
): WorkflowGraphValidationIssue {
  return { code, severity, message, ...fields };
}

export function classifyWorkflowGraphNodeSupport(
  nodes: readonly WorkflowGraphNode[],
  registry: WorkflowNodeRegistry = WORKFLOW_NODE_REGISTRY,
): WorkflowGraphNodeSupport[] {
  return nodes.map((node) => {
    const definition = registry.get(node.type, node.typeVersion);
    return definition
      ? { nodeId: node.id, supported: true, definition }
      : {
          nodeId: node.id,
          supported: false,
          reason: "unknown_type_or_version" as const,
        };
  });
}

export function validateWorkflowNodeResult(
  type: string,
  version: number,
  value: unknown,
  registry: WorkflowNodeRegistry = WORKFLOW_NODE_REGISTRY,
): WorkflowNodeResultValidation {
  const definition = registry.get(type, version);
  if (!definition) {
    return {
      supported: false,
      valid: false,
      errors: [{ path: "", message: `Unsupported Node type ${type}@${version}` }],
    };
  }
  const validate = getSchemaValidator(definition.resultSchema);
  const valid = validate(value);
  return {
    supported: true,
    valid,
    errors: (validate.errors ?? []).map((schemaError) => ({
      path: schemaError.instancePath,
      message: schemaError.message ?? "Node result does not match its schema",
    })),
  };
}

function validateNode(
  node: WorkflowGraphNode,
  definition: WorkflowNodeRegistryDefinition | undefined,
  errors: WorkflowGraphValidationIssue[],
): void {
  const nodeId = typeof node.id === "string" ? node.id : undefined;
  if (!nodeId?.trim()) {
    errors.push(issue("invalid_node_id", "Node ID must be a non-empty string", { nodeId }));
  }
  if (
    typeof node.type !== "string" ||
    !Number.isSafeInteger(node.typeVersion) ||
    node.typeVersion < 1 ||
    typeof node.label !== "string" ||
    !node.label.trim() ||
    typeof node.disabled !== "boolean" ||
    !isRecord(node.position) ||
    !isRecord(node.config)
  ) {
    errors.push(issue("invalid_node_shape", "Node has an invalid shape", { nodeId, path: "node" }));
    return;
  }
  if (
    !Number.isFinite(node.position?.x) ||
    !Number.isFinite(node.position?.y) ||
    node.position.x < WORKFLOW_GRAPH_LIMITS.minPosition ||
    node.position.x > WORKFLOW_GRAPH_LIMITS.maxPosition ||
    node.position.y < WORKFLOW_GRAPH_LIMITS.minPosition ||
    node.position.y > WORKFLOW_GRAPH_LIMITS.maxPosition
  ) {
    errors.push(
      issue("invalid_position", "Node position is outside the supported range", {
        nodeId,
        path: "position",
      }),
    );
  }

  let configBytes: number;
  try {
    configBytes = byteLength(node.config);
  } catch {
    errors.push(
      issue("invalid_node_config", "Node config must be JSON serializable", {
        nodeId,
        path: "config",
      }),
    );
    return;
  }
  if (configBytes > WORKFLOW_GRAPH_LIMITS.maxNodeConfigBytes) {
    errors.push(
      issue("node_config_too_large", "Node config exceeds 64 KiB", {
        nodeId,
        path: "config",
      }),
    );
  }
  if (!definition) return;

  const validate = getSchemaValidator(definition.configSchema);
  if (!validate(node.config)) {
    for (const schemaError of validate.errors ?? []) {
      errors.push(
        issue(
          "invalid_node_config",
          schemaError.message ?? "Node config does not match its schema",
          {
            nodeId,
            path: `config${schemaError.instancePath}`,
          },
        ),
      );
    }
  }

  const requested = (node.config as { permissions?: Record<string, unknown> }).permissions;
  if (requested) {
    for (const key of ["write", "subagent", "browser"] as const) {
      if (requested[key] === true && !definition.permissionCeiling[key]) {
        errors.push(
          issue(
            "permission_ceiling_exceeded",
            `${key} permission exceeds the ${definition.type} ceiling`,
            { nodeId, path: `config.permissions.${key}` },
          ),
        );
      }
    }
  }
}

function hasPath(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  from: string,
  to: string,
): boolean {
  const pending = [from];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === to) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) pending.push(next);
  }
  return false;
}

function findCycleNode(
  nodeIds: readonly string[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): string | undefined {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (nodeId: string): string | undefined => {
    if (visiting.has(nodeId)) return nodeId;
    if (visited.has(nodeId)) return undefined;
    visiting.add(nodeId);
    for (const target of adjacency.get(nodeId) ?? []) {
      const cycleNode = visit(target);
      if (cycleNode) return cycleNode;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return undefined;
  };

  for (const nodeId of nodeIds) {
    const cycleNode = visit(nodeId);
    if (cycleNode) return cycleNode;
  }
  return undefined;
}

function validateTopology(
  nodes: readonly WorkflowGraphNode[],
  definitions: ReadonlyMap<string, WorkflowNodeRegistryDefinition>,
  validEdges: readonly WorkflowGraphEdge[],
  errors: WorkflowGraphValidationIssue[],
  warnings: WorkflowGraphValidationIssue[],
): void {
  const nodeIds = nodes.map((node) => node.id);
  const adjacency = new Map<string, Set<string>>(nodeIds.map((id) => [id, new Set()]));
  const indegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const incomingByPort = new Map<string, number>();
  const outgoingByPort = new Map<string, number>();

  for (const edge of validEdges) {
    const incomingKey = `${edge.target}\u0000${edge.targetHandle}`;
    const outgoingKey = `${edge.source}\u0000${edge.sourceHandle}`;
    incomingByPort.set(incomingKey, (incomingByPort.get(incomingKey) ?? 0) + 1);
    outgoingByPort.set(outgoingKey, (outgoingByPort.get(outgoingKey) ?? 0) + 1);
    if (edge.kind !== "feedback") {
      adjacency.get(edge.source)?.add(edge.target);
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    }
  }

  for (const node of nodes) {
    const definition = definitions.get(node.id);
    if (!definition) continue;
    for (const port of definition.inputs) {
      const count = incomingByPort.get(`${node.id}\u0000${port.id}`) ?? 0;
      if (port.required && count === 0) {
        errors.push(
          issue("missing_required_input", `Required input ${port.id} is not connected`, {
            nodeId: node.id,
            path: `inputs.${port.id}`,
          }),
        );
      }
      if (!port.multiple && count > 1) {
        errors.push(
          issue("duplicate_port_connection", `Input ${port.id} accepts one connection`, {
            nodeId: node.id,
            path: `inputs.${port.id}`,
          }),
        );
      }
    }
    for (const port of definition.outputs) {
      const count = outgoingByPort.get(`${node.id}\u0000${port.id}`) ?? 0;
      if (!port.multiple && count > 1) {
        errors.push(
          issue("duplicate_port_connection", `Output ${port.id} accepts one connection`, {
            nodeId: node.id,
            path: `outputs.${port.id}`,
          }),
        );
      }
    }
  }

  const cycleNode = findCycleNode(nodeIds, adjacency);
  if (cycleNode) {
    errors.push(
      issue("dependency_cycle", "Non-feedback edges must form a DAG", {
        nodeId: cycleNode,
      }),
    );
  }

  const sources = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  const reachable = new Set<string>();
  const pending = [...sources];
  while (pending.length) {
    const current = pending.pop()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const target of adjacency.get(current) ?? []) pending.push(target);
  }

  for (const nodeId of nodeIds) {
    if (!reachable.has(nodeId)) {
      warnings.push(
        issue(
          "unreachable_node",
          "Node is unreachable from a graph entry point",
          { nodeId },
          "warning",
        ),
      );
    }
  }

  const hasTerminal = [...reachable].some((nodeId) => {
    const definition = definitions.get(nodeId);
    return (
      (adjacency.get(nodeId)?.size ?? 0) === 0 ||
      definition?.outputs.some((port) => port.terminal) === true
    );
  });
  if (nodeIds.length > 0 && !hasTerminal) {
    errors.push(issue("missing_terminal_path", "Graph has no reachable terminal path"));
  }

  const writeNodes = nodes.filter((node) => {
    const permissions = (node.config as { permissions?: { write?: unknown } }).permissions;
    return definitions.has(node.id) && permissions?.write === true;
  });
  for (let left = 0; left < writeNodes.length; left += 1) {
    for (let right = left + 1; right < writeNodes.length; right += 1) {
      const a = writeNodes[left];
      const b = writeNodes[right];
      if (!hasPath(adjacency, a.id, b.id) && !hasPath(adjacency, b.id, a.id)) {
        errors.push(
          issue(
            "parallel_write_nodes",
            `Write nodes ${a.id} and ${b.id} can run in parallel`,
            { nodeId: b.id },
          ),
        );
      }
    }
  }
}

export function validateWorkflowGraph(
  graph: WorkflowGraphDraft,
  options: {
    registry?: WorkflowNodeRegistry;
    allowUnsupported?: boolean;
  } = {},
): WorkflowGraphValidationResult {
  const registry = options.registry ?? WORKFLOW_NODE_REGISTRY;
  const errors: WorkflowGraphValidationIssue[] = [];
  const warnings: WorkflowGraphValidationIssue[] = [];

  if (graph.schemaVersion !== WORKFLOW_GRAPH_SCHEMA_VERSION) {
    errors.push(issue("invalid_schema_version", "Unsupported graph schema version"));
  }
  if (graph.registryVersion !== registry.version) {
    errors.push(issue("invalid_registry_version", "Graph registry version does not match"));
  }

  try {
    if (byteLength(graph) > WORKFLOW_GRAPH_LIMITS.maxGraphBytes) {
      errors.push(issue("graph_too_large", "Graph exceeds 2 MiB"));
    }
  } catch {
    errors.push(issue("graph_too_large", "Graph must be JSON serializable"));
  }
  if (graph.nodes.length > WORKFLOW_GRAPH_LIMITS.maxNodes) {
    errors.push(issue("too_many_nodes", "Graph exceeds 100 nodes"));
  }
  if (graph.edges.length > WORKFLOW_GRAPH_LIMITS.maxEdges) {
    errors.push(issue("too_many_edges", "Graph exceeds 300 edges"));
  }
  if (
    graph.viewport &&
    (!Number.isFinite(graph.viewport.x) ||
      !Number.isFinite(graph.viewport.y) ||
      !Number.isFinite(graph.viewport.zoom) ||
      graph.viewport.zoom < WORKFLOW_GRAPH_LIMITS.minZoom ||
      graph.viewport.zoom > WORKFLOW_GRAPH_LIMITS.maxZoom)
  ) {
    errors.push(issue("invalid_viewport", "Viewport is outside the supported range", { path: "viewport" }));
  }

  const nodeById = new Map<string, WorkflowGraphNode>();
  const definitions = new Map<string, WorkflowNodeRegistryDefinition>();
  for (const node of graph.nodes) {
    if (!isRecord(node)) {
      errors.push(issue("invalid_node_shape", "Node must be an object", { path: "nodes" }));
      continue;
    }
    const nodeValue = node as unknown as WorkflowGraphNode;
    const nodeId = typeof nodeValue.id === "string" ? nodeValue.id : undefined;
    if (!nodeId?.trim()) {
      validateNode(nodeValue, undefined, errors);
      continue;
    }
    if (nodeById.has(nodeId)) {
      errors.push(issue("duplicate_node_id", `Duplicate Node ID ${nodeId}`, { nodeId }));
      continue;
    }
    nodeById.set(nodeId, nodeValue);
    const definition = registry.get(nodeValue.type, nodeValue.typeVersion);
    if (!definition && !options.allowUnsupported) {
      errors.push(
        issue(
          "unsupported_node_type",
          `Unsupported Node type ${nodeValue.type}@${nodeValue.typeVersion}`,
          { nodeId },
        ),
      );
    }
    if (definition) definitions.set(nodeId, definition);
    validateNode(nodeValue, definition, errors);
  }

  const edgeIds = new Set<string>();
  const validEdges: WorkflowGraphEdge[] = [];
  for (const edge of graph.edges) {
    if (!isRecord(edge)) {
      errors.push(issue("invalid_edge_shape", "Edge must be an object", { path: "edges" }));
      continue;
    }
    const edgeId = typeof edge.id === "string" ? edge.id : undefined;
    if (!edgeId?.trim()) {
      errors.push(issue("invalid_edge_id", "Edge ID must be a non-empty string", { edgeId }));
      continue;
    }
    if (
      typeof edge.source !== "string" ||
      typeof edge.sourceHandle !== "string" ||
      typeof edge.target !== "string" ||
      typeof edge.targetHandle !== "string" ||
      typeof edge.kind !== "string"
    ) {
      errors.push(issue("invalid_edge_shape", "Edge has an invalid shape", { edgeId, path: "edge" }));
      continue;
    }
    if (edgeIds.has(edgeId)) {
      errors.push(issue("duplicate_edge_id", `Duplicate Edge ID ${edgeId}`, { edgeId }));
      continue;
    }
    edgeIds.add(edgeId);
    if (edge.source === edge.target) {
      errors.push(issue("self_edge", "Self edges are not allowed", { edgeId: edge.id }));
      continue;
    }
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source) {
      errors.push(issue("missing_source_node", `Source Node ${edge.source} does not exist`, { edgeId: edge.id }));
    }
    if (!target) {
      errors.push(issue("missing_target_node", `Target Node ${edge.target} does not exist`, { edgeId: edge.id }));
    }
    if (!source || !target) continue;
    const sourceDefinition = definitions.get(source.id);
    const targetDefinition = definitions.get(target.id);
    if (!sourceDefinition || !targetDefinition) continue;
    const sourcePort = portById(sourceDefinition.outputs, edge.sourceHandle);
    const targetPort = portById(targetDefinition.inputs, edge.targetHandle);
    if (!sourcePort) {
      errors.push(issue("missing_source_port", `Source port ${edge.sourceHandle} does not exist`, { edgeId: edge.id }));
    }
    if (!targetPort) {
      errors.push(issue("missing_target_port", `Target port ${edge.targetHandle} does not exist`, { edgeId: edge.id }));
    }
    if (!sourcePort || !targetPort) continue;
    if (sourcePort.dataType !== targetPort.dataType) {
      errors.push(issue("incompatible_port", "Source and target port data types differ", { edgeId: edge.id }));
      continue;
    }
    if (
      !edgeKinds.has(edge.kind) ||
      !sourcePort.edgeKinds.includes(edge.kind) ||
      !targetPort.edgeKinds.includes(edge.kind)
    ) {
      errors.push(issue("incompatible_edge_kind", `Edge kind ${edge.kind} is not allowed by its ports`, { edgeId: edge.id }));
      continue;
    }
    if (edge.kind === "feedback" && sourceDefinition.category !== "control") {
      errors.push(issue("invalid_feedback_edge", "Feedback edges must originate from a Control Node", { edgeId: edge.id }));
      continue;
    }
    validEdges.push(edge);
  }

  validateTopology([...nodeById.values()], definitions, validEdges, errors, warnings);

  return { valid: errors.length === 0, errors, warnings };
}

export function validateWorkflowGraphForExecution(
  graph: WorkflowGraphDraft,
  registry: WorkflowNodeRegistry = WORKFLOW_NODE_REGISTRY,
): WorkflowGraphValidationResult {
  return validateWorkflowGraph(graph, { registry, allowUnsupported: false });
}
