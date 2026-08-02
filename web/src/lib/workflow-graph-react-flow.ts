import type { Edge, Node } from "@xyflow/react";
import {
  WORKFLOW_NODE_REGISTRY,
  type WorkflowNodeRegistryDefinition,
} from "./workflow-node-registry";
import type {
  WorkflowGraphDraft,
  WorkflowGraphEdge,
  WorkflowGraphNode,
} from "./workflow-graph-types";

export type WorkflowGraphRuntimeState = {
  nodeId: string;
  status: string;
  attemptNo: number;
  dispatchStatus?: string;
  attention?: boolean;
};

export type WorkflowGraphDirection = "LR" | "TB";

export type WorkflowGraphReactNodeData = {
  graphNode: WorkflowGraphNode;
  definition?: WorkflowNodeRegistryDefinition;
  status: string;
  attemptNo: number;
  dispatchStatus?: string;
  attention: boolean;
  unsupported: boolean;
  reducedMotion: boolean;
};

export type WorkflowGraphReactEdgeData = {
  graphEdge: WorkflowGraphEdge;
  active: boolean;
  reducedMotion: boolean;
};

export type WorkflowGraphReactNode = Node<
  WorkflowGraphReactNodeData,
  "workflowGraphNode"
>;

export type WorkflowGraphReactEdge = Edge<
  WorkflowGraphReactEdgeData,
  "workflowGraphEdge"
>;

const RUNNING_STATUSES = new Set([
  "creating_session",
  "dispatching",
  "running",
]);

function isRunning(status: string | undefined): boolean {
  return status !== undefined && RUNNING_STATUSES.has(status);
}

function stateMap(
  states: readonly WorkflowGraphRuntimeState[],
): ReadonlyMap<string, WorkflowGraphRuntimeState> {
  return new Map(states.map((state) => [state.nodeId, state]));
}

export function toWorkflowGraphReactFlow(
  graph: WorkflowGraphDraft,
  states: readonly WorkflowGraphRuntimeState[] = [],
  reducedMotion = false,
  direction: WorkflowGraphDirection = "LR",
): {
  nodes: WorkflowGraphReactNode[];
  edges: WorkflowGraphReactEdge[];
} {
  const runtimeStates = stateMap(states);
  const nodeStates = new Map<string, string>();
  const verticalPositions = new Map<string, { x: number; y: number }>();
  if (direction === "TB") {
    const ranks = [...new Set(graph.nodes.map((node) => node.position.x))].sort((a, b) => a - b);
    for (const [rank, x] of ranks.entries()) {
      const nodesAtRank = graph.nodes
        .filter((node) => node.position.x === x)
        .sort((a, b) => a.position.y - b.position.y);
      nodesAtRank.forEach((node, index) => {
        verticalPositions.set(node.id, {
          x: (index - (nodesAtRank.length - 1) / 2) * 280,
          y: rank * 220,
        });
      });
    }
  }
  const nodes = graph.nodes.map<WorkflowGraphReactNode>((graphNode) => {
    const definition = WORKFLOW_NODE_REGISTRY.get(
      graphNode.type,
      graphNode.typeVersion,
    );
    const state = runtimeStates.get(graphNode.id);
    const status = definition ? state?.status ?? "ready" : "unsupported";
    nodeStates.set(graphNode.id, status);
    return {
      id: graphNode.id,
      type: "workflowGraphNode",
      position: verticalPositions.get(graphNode.id) ?? { ...graphNode.position },
      data: {
        graphNode,
        definition,
        status,
        attemptNo: state?.attemptNo ?? 0,
        dispatchStatus: state?.dispatchStatus,
        attention: state?.attention === true,
        unsupported: definition === undefined,
        reducedMotion,
      },
      draggable: false,
      selectable: true,
      connectable: false,
      focusable: true,
      ariaRole: "group",
    };
  });

  const edges = graph.edges.map<WorkflowGraphReactEdge>((graphEdge) => {
    const active =
      isRunning(nodeStates.get(graphEdge.source)) ||
      isRunning(nodeStates.get(graphEdge.target));
    return {
      id: graphEdge.id,
      type: "workflowGraphEdge",
      source: graphEdge.source,
      target: graphEdge.target,
      sourceHandle: graphEdge.sourceHandle,
      targetHandle: graphEdge.targetHandle,
      label: graphEdge.label,
      animated: active && !reducedMotion,
      selectable: false,
      reconnectable: false,
      focusable: false,
      data: { graphEdge, active, reducedMotion },
      className: [
        "workflow-graph-edge",
        `workflow-graph-edge--${graphEdge.kind}`,
        active ? "workflow-graph-edge--active" : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  });

  return { nodes, edges };
}
