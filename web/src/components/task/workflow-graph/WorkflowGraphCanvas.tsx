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
  const pendingViewport = useRef<Viewport | null>(null);
  const viewportSaveInFlight = useRef(false);
  const moveStarted = useRef(false);
  const graphRevisionRef = useRef(graphRevision);
  graphRevisionRef.current = graphRevision;
  // #region debug log
  useEffect(() => {
    void fetch('http://127.0.0.1:52338/ingest/8d185c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'8d185c',runId:'initial',hypothesisId:'A,B,C',location:'WorkflowGraphCanvas.tsx:78',message:'canvas render inputs',data:{graphRevision,hasViewport:Boolean(graph.viewport),viewport:graph.viewport,nodeCount:nodes.length,nodePositions:nodes.map((node) => ({id:node.id,x:node.position.x,y:node.position.y})),direction},timestamp:Date.now()})}).catch(()=>{});
  }, [direction, graphRevision, graph.viewport, nodes]);
  // #endregion
  useEffect(() => () => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
  }, []);
  const flushViewport = () => {
    if (viewportSaveInFlight.current || !pendingViewport.current) return;
    const nextViewport = pendingViewport.current;
    pendingViewport.current = null;
    viewportSaveInFlight.current = true;
    void sendJson("PATCH", `/api/tasks/${encodeURIComponent(taskId)}/workflow/graph`, {
      expectedGraphRevision: graphRevisionRef.current,
      operations: [{ op: "set_viewport", viewport: nextViewport }],
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
    }).finally(() => {
      viewportSaveInFlight.current = false;
      if (pendingViewport.current) {
        persistTimer.current = setTimeout(flushViewport, 250);
      }
    });
  };
  const persistViewport = (_event: unknown, viewport: Viewport) => {
    // #region debug log
    void fetch('http://127.0.0.1:52338/ingest/8d185c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'8d185c',runId:'initial',hypothesisId:'A,B',location:'WorkflowGraphCanvas.tsx:103',message:'move end viewport',data:{viewport,moveStarted:moveStarted.current,graphRevision:graphRevisionRef.current},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!editingEnabled || !isWorkflowGraphEditEnabled() || !moveStarted.current) return;
    moveStarted.current = false;
    pendingViewport.current = viewport;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(flushViewport, 250);
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
        onMoveStart={() => {
          // #region debug log
          void fetch('http://127.0.0.1:52338/ingest/8d185c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'8d185c',runId:'initial',hypothesisId:'A,B',location:'WorkflowGraphCanvas.tsx:161',message:'move start',data:{graphRevision:graphRevisionRef.current},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          moveStarted.current = true;
        }}
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
