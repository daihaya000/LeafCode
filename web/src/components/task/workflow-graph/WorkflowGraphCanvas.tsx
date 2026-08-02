"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type Viewport,
} from "@xyflow/react";
import type { WorkflowGraphDraft } from "@/lib/workflow-graph-types";
import {
  toWorkflowGraphReactFlow,
  type WorkflowGraphReactEdge,
  type WorkflowGraphReactNode,
  type WorkflowGraphDirection,
  type WorkflowGraphRuntimeState,
} from "@/lib/workflow-graph-react-flow";
import { WorkflowGraphEdge } from "./WorkflowGraphEdge";
import { WorkflowGraphNode } from "./WorkflowGraphNode";
import { ApiError, sendJson } from "@/lib/client";
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
  selectedEdgeId,
  onSelectEdge,
  direction,
  taskId,
  graphRevision,
  onRefresh,
  editingEnabled = true,
}: {
  graph: WorkflowGraphDraft;
  states: readonly WorkflowGraphRuntimeState[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  selectedEdgeId: string | null;
  onSelectEdge: (edgeId: string | null) => void;
  direction: WorkflowGraphDirection;
  taskId: string;
  graphRevision: number;
  onRefresh: () => Promise<void>;
  editingEnabled?: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [viewportError, setViewportError] = useState<string | null>(null);
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
  const edges = useMemo(
    () => elements.edges.map((edge) => ({ ...edge, selected: edge.id === selectedEdgeId })),
    [elements.edges, selectedEdgeId],
  );
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveStarted = useRef(false);
  const graphRevisionRef = useRef(graphRevision);
  graphRevisionRef.current = graphRevision;
  useEffect(() => () => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
  }, []);
  const persistViewport = (_event: unknown, viewport: Viewport) => {
    if (!editingEnabled || !isWorkflowGraphEditEnabled() || !moveStarted.current) return;
    moveStarted.current = false;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void sendJson("PATCH", `/api/tasks/${encodeURIComponent(taskId)}/workflow/graph`, {
        expectedGraphRevision: graphRevisionRef.current,
        operations: [{ op: "set_viewport", viewport }],
      }).then(() => {
        setViewportError(null);
        return onRefresh();
      }).catch((error: unknown) => {
        setViewportError(
          error instanceof ApiError && error.status === 409
            ? "Graphが更新されたためViewportを保存できませんでした。最新Graphを再読込してください。"
            : error instanceof Error
              ? error.message
              : "Viewportの保存に失敗しました。",
        );
        return onRefresh().catch(() => undefined);
      });
    }, 250);
  };
  const handleNodeClick: NodeMouseHandler<WorkflowGraphReactNode> = (_event, node) => {
    onSelectNode(node.id);
    onSelectEdge(null);
  };
  const handleEdgeClick: EdgeMouseHandler<WorkflowGraphReactEdge> = (_event, edge) => {
    onSelectNode(null);
    onSelectEdge(edge.id);
  };

  return (
    <div
      className="workflow-graph-canvas h-full min-h-[28rem] w-full overflow-hidden rounded-lg border border-border bg-surface-2"
      data-testid="workflow-graph-canvas"
      aria-label="Workflow Graph canvas"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
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
        edgesFocusable
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={() => { onSelectNode(null); onSelectEdge(null); }}
        onMoveStart={() => { moveStarted.current = true; }}
        onMoveEnd={persistViewport}
        defaultViewport={graph.viewport}
        aria-label="Workflow Graphを移動・拡大縮小できます"
      >
        <Background variant={BackgroundVariant.Dots} gap={32} size={1} />
        <Controls
          showInteractive={false}
          position="bottom-left"
          className="workflow-graph-controls [&_button]:!h-11 [&_button]:!w-11"
          aria-label="Workflow Graph操作"
        />
        {direction === "LR" && (
          <MiniMap
            position="bottom-right"
            nodeColor="var(--accent)"
            nodeStrokeColor="var(--border-strong)"
            nodeBorderRadius={8}
            aria-label="Workflow Graph全体図"
          />
        )}
        <Panel position="top-left" className="workflow-graph-legend">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-muted">
            <span className="rounded-full bg-surface-2 px-2 py-0.5">{graph.nodes.length} Nodes</span>
            <span className="rounded-full bg-surface-2 px-2 py-0.5">{graph.edges.length} Edges</span>
            <span className="hidden sm:inline">{editingEnabled ? "選択で詳細 · ドラッグで移動" : "読み取り専用 · 選択で詳細"}</span>
          </div>
        </Panel>
        {viewportError && (
          <Panel position="top-right" className="max-w-[min(22rem,calc(100%-1rem))] rounded-md border border-warning/40 bg-warning-bg px-2.5 py-2 text-[11px] text-warning shadow-sm" role="alert">
            <p>{viewportError}</p>
            <button type="button" className="mt-1 underline underline-offset-2" onClick={() => { setViewportError(null); void onRefresh(); }}>最新Graphを再読込</button>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
