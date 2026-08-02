"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Circle, Loader2, PauseCircle } from "lucide-react";
import { getJson } from "@/lib/client";
import { isWorkflowGraphEnabled } from "@/lib/workflow-feature";
import { synthesizeWorkflowGraph } from "@/lib/workflow-graph-compat";
import type { WorkflowGraphDraft } from "@/lib/workflow-graph-types";
import type { WorkflowView } from "@/lib/workflow-service";
import type { WorkflowDefinitionSnapshot } from "@/lib/workflow-types";
import { cx } from "@/components/ui";
import { WorkflowGraphPanel } from "./workflow-graph/WorkflowGraphPanel";

type WorkflowResponse = { workflow: WorkflowView };
type GraphResponse = { graph: WorkflowGraphDraft };

function isLegacyWorkflowDefinitionSnapshot(value: unknown): value is WorkflowDefinitionSnapshot {
  return Boolean(value && typeof value === "object" && "templateKey" in value);
}

const labels: Record<string, string> = {
  implement_ui: "Implement UI",
  code_review: "Code Review",
  visual_judge: "Visual Judge",
};

function statusLabel(status: string): string {
  if (status === "succeeded" || status === "completed") return "完了";
  if (status === "running" || status === "dispatching") return "実行中";
  if (status === "paused") return "一時停止";
  if (status === "failed") return "失敗";
  return "待機中";
}

function statusIcon(status: string) {
  if (status === "succeeded" || status === "completed") return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />;
  if (status === "running" || status === "dispatching") return <Loader2 className="h-4 w-4 animate-spin text-working" aria-hidden="true" />;
  if (status === "failed") return <AlertCircle className="h-4 w-4 text-danger" aria-hidden="true" />;
  if (status === "paused") return <PauseCircle className="h-4 w-4 text-warning" aria-hidden="true" />;
  return <Circle className="h-4 w-4 text-faint" aria-hidden="true" />;
}

export function WorkflowPanel({
  taskId,
  onOpenChat = () => undefined,
  onOpenDiff = () => undefined,
}: {
  taskId: string;
  onOpenChat?: (nodeId: string) => void;
  onOpenDiff?: (nodeId: string) => void;
}) {
  const graphEnabled = isWorkflowGraphEnabled();
  const [workflow, setWorkflow] = useState<WorkflowView | null>(null);
  const [graphDraft, setGraphDraft] = useState<WorkflowGraphDraft | null>(null);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await getJson<WorkflowResponse>(`/api/tasks/${encodeURIComponent(taskId)}/workflow`);
      setWorkflow(response.workflow);
      if (graphEnabled) {
        try {
          const graphResponse = await getJson<GraphResponse>(
            `/api/tasks/${encodeURIComponent(taskId)}/workflow/graph`,
          );
          setGraphDraft(graphResponse.graph);
        } catch {
          setGraphDraft(null);
        }
      } else {
        setGraphDraft(null);
      }
      setError(null);
    } catch {
      setError("Workflow状態を取得できませんでした。");
    }
  }, [graphEnabled, taskId]);

  useEffect(() => {
    void load();
    const source = new EventSource(`/api/tasks/${encodeURIComponent(taskId)}/workflow/events`);
    const onUpdate = (event: Event) => {
      try {
        const data = JSON.parse((event as MessageEvent<string>).data) as { workflow?: WorkflowView };
        if (data.workflow) setWorkflow(data.workflow);
      } catch {
        void load();
      }
    };
    source.addEventListener("workflow.updated", onUpdate);
    source.onerror = () => { void load(); };
    return () => {
      source.removeEventListener("workflow.updated", onUpdate);
      source.close();
    };
  }, [load, taskId]);

  const graphState = useMemo(() => {
    if (!graphEnabled || !workflow?.run) return null;
    if (graphDraft) return { graph: graphDraft, error: null, editable: true };
    const snapshot = workflow.run.definitionSnapshot;
    if (!isLegacyWorkflowDefinitionSnapshot(snapshot)) {
      return {
        graph: null,
        error: "Execution SnapshotをGraphへ変換できないため、従来のWorkflow表示を使用しています。",
        editable: false,
      };
    }
    try {
      return {
        graph: synthesizeWorkflowGraph(snapshot, {
          id: `compat:${workflow.run.id}`,
          workspaceId: workflow.workspaceId,
          graphRevision: workflow.run.revision,
          createdAt: workflow.run.createdAt,
          updatedAt: workflow.run.updatedAt,
        }),
        error: "Graph Draftを取得できないため、互換Graphを読み取り専用で表示しています。",
        editable: false,
      };
    } catch {
      return {
        graph: null,
        error: "互換Graphを生成できないため、従来のWorkflow表示を使用しています。",
        editable: false,
      };
    }
  }, [graphDraft, graphEnabled, workflow]);

  const completed = useMemo(
    () => workflow?.nodes.filter((node) => node.attempts.at(-1)?.status === "succeeded").length ?? 0,
    [workflow],
  );
  if (error && !workflow) return <div role="alert" className="p-4 text-sm text-danger">{error}</div>;
  if (!workflow) return <div className="flex items-center gap-2 p-4 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />読み込み中…</div>;

  if (graphState?.graph) {
    return (
      <WorkflowGraphPanel
        graph={graphState.graph}
        workflow={workflow}
        graphError={graphState.error}
        graphEditAvailable={graphState.editable}
        taskId={taskId}
        onOpenChat={onOpenChat}
        onOpenDiff={onOpenDiff}
        onRefresh={load}
      />
    );
  }

  const attention = workflow.run?.status === "paused";
  return (
    <section aria-label="Workflow進捗" className="flex min-h-0 flex-1 flex-col overflow-auto bg-surface-2 p-3 sm:p-4">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-text">Workflow</h2>
            <p className="mt-1 text-xs text-muted">{completed}/{workflow.nodes.length} Node完了 · revision {workflow.run?.revision ?? workflow.workspaceRevision}</p>
          </div>
          <span className={cx("rounded-full border px-2.5 py-1 text-xs font-medium", attention ? "border-warning/40 bg-warning-bg text-warning" : "border-border bg-surface text-muted")}>
            {attention ? "Attention待ち" : statusLabel(workflow.run?.status ?? "ready")}
          </span>
        </div>
        {attention && workflow.run?.pauseReason && <p role="status" className="mb-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">確認が必要です: {workflow.run.pauseReason}</p>}
        <ol className="grid gap-3 md:grid-cols-3" aria-label="Workflow Node一覧">
          {workflow.nodes.map((node) => {
            const attempt = node.attempts.at(-1);
            const status = attempt?.status ?? "ready";
            return (
              <li key={node.nodeKey} className="rounded-xl border border-border bg-surface shadow-sm">
                <button type="button" className="w-full rounded-xl p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary" aria-expanded={selectedNodeKey === node.nodeKey} onClick={() => setSelectedNodeKey((current) => current === node.nodeKey ? null : node.nodeKey)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">{statusIcon(status)}<h3 className="truncate text-sm font-semibold text-text">{labels[node.nodeKey] ?? node.nodeKey}</h3></div>
                    <span className="shrink-0 text-xs text-muted">{statusLabel(status)}</span>
                  </div>
                  <p className="mt-3 text-xs text-muted">Attempt {node.latestAttemptNo || "—"}</p>
                  {attempt?.dispatchStatus && <p className="mt-1 truncate text-xs text-faint">{attempt.dispatchStatus}</p>}
                </button>
                {selectedNodeKey === node.nodeKey && (
                  <div className="border-t border-border px-4 py-3 text-xs text-muted">
                    <p className="font-medium text-text">Node詳細</p>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                      <dt>Agent</dt><dd className="truncate">{String(((node.config ?? {}) as { agentName?: unknown }).agentName ?? "未解決")}</dd>
                      <dt>Attempt</dt><dd>{node.attempts.length}</dd>
                      <dt>Session</dt><dd className="truncate">{attempt?.opencodeSessionId ?? "未作成"}</dd>
                    </dl>
                    {attention && <p className="mt-2 rounded-md bg-warning-bg px-2 py-1 text-warning">このNodeのAttentionを確認してください。</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {error && <p role="status" className="mt-3 text-xs text-warning">{error}</p>}
      </div>
    </section>
  );
}
