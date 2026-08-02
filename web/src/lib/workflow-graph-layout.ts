import dagre from "@dagrejs/dagre";
import type { WorkflowGraphDirection } from "./workflow-graph-react-flow";
import type { WorkflowGraphDraft, WorkflowGraphPosition } from "./workflow-graph-types";

export const WORKFLOW_GRAPH_NODE_SIZE = { width: 208, height: 96 } as const;

export function layoutWorkflowGraph(
  graph: WorkflowGraphDraft,
  direction: WorkflowGraphDirection,
): ReadonlyMap<string, WorkflowGraphPosition> {
  const layout = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  layout.setGraph({
    rankdir: direction,
    ranksep: 150,
    nodesep: 72,
    marginx: 32,
    marginy: 32,
  });
  for (const node of graph.nodes) {
    layout.setNode(node.id, { ...WORKFLOW_GRAPH_NODE_SIZE });
  }
  for (const edge of graph.edges) {
    if (edge.kind === "feedback") continue;
    layout.setEdge(edge.source, edge.target);
  }
  dagre.layout(layout);

  return new Map(
    graph.nodes.map((node) => {
      const positioned = layout.node(node.id);
      return [
        node.id,
        positioned
          ? {
              x: Math.round(positioned.x - WORKFLOW_GRAPH_NODE_SIZE.width / 2),
              y: Math.round(positioned.y - WORKFLOW_GRAPH_NODE_SIZE.height / 2),
            }
          : node.position,
      ];
    }),
  );
}
