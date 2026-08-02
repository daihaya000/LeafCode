"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { CircleAlert } from "lucide-react";
import type { WorkflowView } from "@/lib/workflow-service";
import type { WorkflowGraphDraft } from "@/lib/workflow-graph-types";
import type { WorkflowGraphRuntimeState } from "@/lib/workflow-graph-react-flow";
import type { WorkflowGraphDirection } from "@/lib/workflow-graph-react-flow";
import { cx } from "@/components/ui";
import { WorkflowGraphList } from "./WorkflowGraphList";
import { WorkflowGraphInspector } from "./WorkflowGraphInspector";
import { WorkflowGraphEditor } from "./WorkflowGraphEditor";

const WorkflowGraphCanvas = dynamic(
  () => import("./WorkflowGraphCanvas").then((module) => module.WorkflowGraphCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[22rem] items-center justify-center rounded-lg border border-border bg-surface-2 text-sm text-muted">
        Graphを読み込み中…
      </div>
    ),
  },
);

type WorkflowGraphViewportMode = "mobile" | "tablet" | "desktop";

function useWorkflowGraphViewportMode(): WorkflowGraphViewportMode {
  const read = () => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "desktop" as const;
    if (window.matchMedia("(max-width: 767px)").matches) return "mobile" as const;
    if (window.matchMedia("(max-width: 1279px)").matches) return "tablet" as const;
    return "desktop" as const;
  };
  const [mode, setMode] = useState<WorkflowGraphViewportMode>(read);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const queries = [
      window.matchMedia("(max-width: 767px)"),
      window.matchMedia("(max-width: 1279px)"),
    ];
    const update = () => setMode(read());
    queries.forEach((query) => query.addEventListener?.("change", update));
    return () => queries.forEach((query) => query.removeEventListener?.("change", update));
  }, []);
  return mode;
}

function statusLabel(status: string): string {
  if (status === "completed" || status === "succeeded") return "完了";
  if (["creating_session", "dispatching", "running"].includes(status)) return "実行中";
  if (status === "paused") return "一時停止";
  if (status === "failed") return "失敗";
  return "待機中";
}

function runtimeStates(workflow: WorkflowView): WorkflowGraphRuntimeState[] {
  const states: WorkflowGraphRuntimeState[] = workflow.nodes.map((node) => {
    const attempt = node.attempts.at(-1);
    return {
      nodeId: node.nodeKey,
      status: attempt?.status ?? "ready",
      attemptNo: node.latestAttemptNo,
      dispatchStatus: attempt?.dispatchStatus,
      attention: workflow.run?.status === "paused" && node.nodeKey === workflow.run.primaryNodeKey,
    };
  });
  const runStatus = workflow.run?.status ?? "ready";
  if (!workflow.nodes.some((node) => node.nodeKey === "review_gate")) {
    states.push({
      nodeId: "review_gate",
      status: runStatus === "completed" ? "succeeded" : runStatus,
      attemptNo: 0,
      attention: runStatus === "paused",
    });
  }
  return states;
}

export function WorkflowGraphPanel({
  graph,
  workflow,
  graphError,
  taskId,
  onOpenChat,
  onOpenDiff,
  onRefresh,
}: {
  graph: WorkflowGraphDraft;
  workflow: WorkflowView;
  graphError?: string | null;
  taskId: string;
  onOpenChat: (nodeId: string) => void;
  onOpenDiff: (nodeId: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const viewportMode = useWorkflowGraphViewportMode();
  const direction: WorkflowGraphDirection = viewportMode === "mobile" ? "TB" : "LR";
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const states = useMemo(() => runtimeStates(workflow), [workflow]);
  const completed = states.filter((state) => ["succeeded", "completed"].includes(state.status)).length;
  const attention = workflow.run?.status === "paused";
  const selectedGraphNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedNodeRun = workflow.nodes.find((node) => node.nodeKey === selectedNodeId);

  return (
    <section aria-label="Workflow Graph進捗" data-graph-viewport={viewportMode} data-graph-direction={direction} className="flex min-h-0 flex-1 flex-col overflow-auto bg-surface-2 p-3 sm:p-4">
      <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-1 flex-col">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-text">Workflow Graph</h2>
            <p className="mt-1 text-xs text-muted">{completed}/{states.length} Node完了 · revision {workflow.run?.revision ?? workflow.workspaceRevision}</p>
          </div>
          <span className={cx("rounded-full border px-2.5 py-1 text-xs font-medium", attention ? "border-warning/40 bg-warning-bg text-warning" : "border-border bg-surface text-muted")}>
            {attention ? "Attention待ち" : statusLabel(workflow.run?.status ?? "ready")}
          </span>
        </div>
        {attention && workflow.run?.pauseReason && (
          <p role="status" className="mb-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
            確認が必要です: {workflow.run.pauseReason}
          </p>
        )}
        {graphError && (
          <p role="alert" className="mb-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
            <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            {graphError}
          </p>
        )}
        <WorkflowGraphEditor
          taskId={taskId}
          graph={graph}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          onRefresh={onRefresh}
          direction={direction}
        />
        <div className="relative grid min-h-0 flex-1 gap-3 md:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_17rem_20rem]">
          <WorkflowGraphCanvas
            graph={graph}
            states={states}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onSelectEdge={setSelectedEdgeId}
            direction={direction}
            taskId={taskId}
            graphRevision={graph.graphRevision}
            onRefresh={onRefresh}
          />
          <WorkflowGraphList
            graph={graph}
            states={states}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onSelectEdge={setSelectedEdgeId}
          />
          <WorkflowGraphInspector
            taskId={taskId}
            graphNode={selectedGraphNode}
            nodeRun={selectedNodeRun}
            workflow={workflow}
            graphRevision={graph.graphRevision}
            mode={viewportMode}
            onOpenChat={onOpenChat}
            onOpenDiff={onOpenDiff}
            onRefresh={onRefresh}
          />
        </div>
      </div>
    </section>
  );
}
