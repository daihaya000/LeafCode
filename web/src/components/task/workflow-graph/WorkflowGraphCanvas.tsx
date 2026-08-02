"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  type NodeMouseHandler,
  type Viewport,
} from "@xyflow/react";
import type { WorkflowGraphDraft } from "@/lib/workflow-graph-types";
import {
  toWorkflowGraphReactFlow,
  type WorkflowGraphReactNode,
  type WorkflowGraphDirection,
  type WorkflowGraphRuntimeState,
} from "@/lib/workflow-graph-react-flow";
import { WorkflowGraphEdge } from "./WorkflowGraphEdge";
import { WorkflowGraphNode } from "./WorkflowGraphNode";
import { sendJson } from "@/lib/client";
import { isWorkflowGraphEditEnabled } from "@/lib/workflow-feature";

const nodeTypes = { workflowGraphNode: WorkflowGraphNode };
const edgeTypes = { workflowGraphEdge: WorkflowGraphEdge };

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return reducedMotion;
}

export function WorkflowGraphCanvas({
  graph,
  states,
  selectedNodeId,
  onSelectNode,
  direction,
  taskId,
  graphRevision,
  onRefresh,
}: {
  graph: WorkflowGraphDraft;
  states: readonly WorkflowGraphRuntimeState[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  direction: WorkflowGraphDirection;
  taskId: string;
  graphRevision: number;
  onRefresh: () => Promise<void>;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const elements = useMemo(
    () => toWorkflowGraphReactFlow(graph, states, reducedMotion, direction),
    [direction, graph, reducedMotion, states],
  );
  const nodes = useMemo(
    () =>
      elements.nodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
      })),
    [elements.nodes, selectedNodeId],
  );
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
  }, []);
  const persistViewport = (_event: unknown, viewport: Viewport) => {
    if (!isWorkflowGraphEditEnabled()) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void sendJson("PATCH", `/api/tasks/${encodeURIComponent(taskId)}/workflow/graph`, {
        expectedGraphRevision: graphRevision,
        operations: [{ op: "set_viewport", viewport }],
      }).then(() => onRefresh()).catch(() => undefined);
    }, 250);
  };
  const handleNodeClick: NodeMouseHandler<WorkflowGraphReactNode> = (_event, node) => {
    onSelectNode(node.id);
  };

  return (
    <div
      className="workflow-graph-canvas h-full min-h-[22rem] w-full overflow-hidden rounded-lg border border-border bg-surface-2"
      aria-label="Workflow Graph canvas"
    >
      <ReactFlow
        nodes={nodes}
        edges={elements.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView={!graph.viewport}
        fitViewOptions={{ padding: 0.22 }}
        minZoom={0.25}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        selectNodesOnDrag={false}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        nodesFocusable
        edgesFocusable={false}
        onNodeClick={handleNodeClick}
        onPaneClick={() => onSelectNode(null)}
        onMoveEnd={persistViewport}
        defaultViewport={graph.viewport}
        aria-label="Workflow Graphを移動・拡大縮小できます"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls
          showInteractive={false}
          position="bottom-left"
          aria-label="Workflow Graph操作"
        />
        <MiniMap
          position="bottom-right"
          nodeColor="var(--accent)"
          nodeStrokeColor="var(--border-strong)"
          nodeBorderRadius={8}
          aria-label="Workflow Graph全体図"
        />
        <Panel position="top-left" className="workflow-graph-legend">
          <p className="text-[11px] font-medium text-muted">読み取り専用 · Nodeを選択して詳細を確認</p>
        </Panel>
      </ReactFlow>
    </div>
  );
}
