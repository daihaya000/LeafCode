import {
  BaseEdge,
  EdgeLabelRenderer,
  MarkerType,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import type { WorkflowGraphReactEdge } from "@/lib/workflow-graph-react-flow";
import { cx } from "@/components/ui";

export function WorkflowGraphEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<WorkflowGraphReactEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const kind = data?.graphEdge.kind ?? "dependency";
  return (
    <>
      <title>{`${data?.graphEdge.source ?? ""}から${data?.graphEdge.target ?? ""}、${kind}`}</title>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={MarkerType.ArrowClosed}
        className={cx(
          "workflow-graph-edge-path",
          `workflow-graph-edge-path--${kind}`,
          data?.active && "workflow-graph-edge-path--active",
        )}
      />
      {data?.graphEdge.label && (
        <EdgeLabelRenderer>
          <span
            className="workflow-graph-edge-label nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
          >
            {data.graphEdge.label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
