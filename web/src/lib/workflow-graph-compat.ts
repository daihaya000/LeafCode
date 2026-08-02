import {
  WORKFLOW_NODE_REGISTRY_VERSION,
} from "./workflow-node-registry";
import {
  WORKFLOW_GRAPH_SCHEMA_VERSION,
  type WorkflowGraphDraft,
  type WorkflowGraphEdge,
  type WorkflowGraphNode,
  type WorkflowGraphPosition,
} from "./workflow-graph-types";
import {
  WORKFLOW_TEMPLATE_KEY,
  type WorkflowDefinitionSnapshot,
  type WorkflowNodeDefinition,
  type WorkflowNodeKey,
} from "./workflow-types";

export const WORKFLOW_COMPAT_GATE_NODE_ID = "review_gate";

const COMPAT_NODE_ORDER: readonly WorkflowNodeKey[] = [
  "implement_ui",
  "code_review",
  "visual_judge",
];

const COMPAT_NODE_TYPES: Record<WorkflowNodeKey, string> = {
  implement_ui: "opencode.implement_ui",
  code_review: "opencode.code_review",
  visual_judge: "opencode.visual_judge",
};

const COMPAT_NODE_POSITIONS: Record<
  WorkflowNodeKey | typeof WORKFLOW_COMPAT_GATE_NODE_ID,
  WorkflowGraphPosition
> = {
  implement_ui: { x: 0, y: 0 },
  code_review: { x: 320, y: -160 },
  visual_judge: { x: 320, y: 160 },
  review_gate: { x: 640, y: 0 },
};

const DEFAULT_COMPAT_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export type WorkflowGraphCompatOptions = {
  id?: string;
  workspaceId?: string;
  graphRevision?: number;
  createdAt?: string;
  updatedAt?: string;
  registryVersion?: string;
};

export type WorkflowGraphCompatErrorCode =
  | "unsupported_template"
  | "missing_node"
  | "duplicate_node"
  | "invalid_node_kind"
  | "invalid_edge_topology";

export class WorkflowGraphCompatError extends Error {
  readonly code: WorkflowGraphCompatErrorCode;

  constructor(code: WorkflowGraphCompatErrorCode, message: string) {
    super(message);
    this.name = "WorkflowGraphCompatError";
    this.code = code;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nodeDefinitionMap(
  definition: WorkflowDefinitionSnapshot,
): Map<WorkflowNodeKey, WorkflowNodeDefinition> {
  const nodes = new Map<WorkflowNodeKey, WorkflowNodeDefinition>();
  for (const node of definition.nodes) {
    if (nodes.has(node.key)) {
      throw new WorkflowGraphCompatError(
        "duplicate_node",
        `Workflow definition contains duplicate node ${node.key}`,
      );
    }
    nodes.set(node.key, node);
  }
  for (const nodeKey of COMPAT_NODE_ORDER) {
    if (!nodes.has(nodeKey)) {
      throw new WorkflowGraphCompatError(
        "missing_node",
        `Workflow definition is missing node ${nodeKey}`,
      );
    }
  }
  return nodes;
}

function assertCompatibleDefinition(
  definition: WorkflowDefinitionSnapshot,
  nodes: Map<WorkflowNodeKey, WorkflowNodeDefinition>,
): void {
  if (definition.templateKey !== WORKFLOW_TEMPLATE_KEY) {
    throw new WorkflowGraphCompatError(
      "unsupported_template",
      `Workflow template ${definition.templateKey} is not compatible with the Graph adapter`,
    );
  }
  for (const nodeKey of COMPAT_NODE_ORDER) {
    const node = nodes.get(nodeKey)!;
    const expectedKind = nodeKey === "implement_ui" ? "implement" : "review";
    if (node.kind !== expectedKind) {
      throw new WorkflowGraphCompatError(
        "invalid_node_kind",
        `${nodeKey} must use ${expectedKind} kind`,
      );
    }
  }

  const edgeKeys = new Set(
    definition.edges.map((edge) => `${edge.from}\u0000${edge.to}\u0000${edge.condition}`),
  );
  const expectedEdges = [
    ["implement_ui", "code_review", "completed"],
    ["implement_ui", "visual_judge", "completed"],
    ["code_review", "implement_ui", "blocking_findings"],
    ["visual_judge", "implement_ui", "blocking_findings"],
  ] as const;
  if (
    definition.edges.length !== expectedEdges.length ||
    expectedEdges.some(([from, to, condition]) => !edgeKeys.has(`${from}\u0000${to}\u0000${condition}`))
  ) {
    throw new WorkflowGraphCompatError(
      "invalid_edge_topology",
      "Workflow definition does not match the fixed three-node topology",
    );
  }
}

function toGraphNode(
  node: WorkflowNodeDefinition,
): WorkflowGraphNode {
  return {
    id: node.key,
    type: COMPAT_NODE_TYPES[node.key],
    typeVersion: 1,
    label: node.label,
    position: clone(COMPAT_NODE_POSITIONS[node.key]),
    config: clone(node.config) as Record<string, unknown>,
    disabled: false,
  };
}

function toGateNode(): WorkflowGraphNode {
  return {
    id: WORKFLOW_COMPAT_GATE_NODE_ID,
    type: "control.review_gate",
    typeVersion: 1,
    label: "Review Gate",
    position: clone(COMPAT_NODE_POSITIONS[WORKFLOW_COMPAT_GATE_NODE_ID]),
    config: {},
    disabled: false,
  };
}

function edge(
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  kind: WorkflowGraphEdge["kind"],
  label: string,
): WorkflowGraphEdge {
  return {
    id,
    source,
    sourceHandle,
    target,
    targetHandle,
    kind,
    label,
  };
}

function toGraphEdges(): WorkflowGraphEdge[] {
  return [
    edge(
      "implement_ui-to-code_review",
      "implement_ui",
      "result",
      "code_review",
      "implementation",
      "dependency",
      "completed",
    ),
    edge(
      "implement_ui-to-visual_judge",
      "implement_ui",
      "result",
      "visual_judge",
      "implementation",
      "dependency",
      "completed",
    ),
    edge(
      "code_review-to-review_gate",
      "code_review",
      "result",
      WORKFLOW_COMPAT_GATE_NODE_ID,
      "code_review",
      "control",
      "completed",
    ),
    edge(
      "visual_judge-to-review_gate",
      "visual_judge",
      "result",
      WORKFLOW_COMPAT_GATE_NODE_ID,
      "visual_judge",
      "control",
      "completed",
    ),
    edge(
      "review_gate-to-implement_ui",
      WORKFLOW_COMPAT_GATE_NODE_ID,
      "feedback",
      "implement_ui",
      "feedback",
      "feedback",
      "blocking_findings",
    ),
  ];
}

export function synthesizeWorkflowGraph(
  definition: WorkflowDefinitionSnapshot,
  options: WorkflowGraphCompatOptions = {},
): WorkflowGraphDraft {
  const nodes = nodeDefinitionMap(definition);
  assertCompatibleDefinition(definition, nodes);

  const timestamp = options.updatedAt ?? options.createdAt ?? DEFAULT_COMPAT_TIMESTAMP;
  return {
    id: options.id ?? `compat:${definition.templateKey}`,
    workspaceId: options.workspaceId ?? "compat",
    schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
    graphRevision: options.graphRevision ?? 1,
    registryVersion: options.registryVersion ?? WORKFLOW_NODE_REGISTRY_VERSION,
    nodes: [
      ...COMPAT_NODE_ORDER.map((nodeKey) => toGraphNode(nodes.get(nodeKey)!)),
      toGateNode(),
    ],
    edges: toGraphEdges(),
    createdAt: options.createdAt ?? timestamp,
    updatedAt: options.updatedAt ?? timestamp,
  };
}

export const createWorkflowGraphCompat = synthesizeWorkflowGraph;
