import { useState } from "react";
import { MessageSquare, RefreshCw, TriangleAlert } from "lucide-react";
import { sendJson } from "@/lib/client";
import type { WorkflowAttemptView, WorkflowNodeView, WorkflowView } from "@/lib/workflow-service";
import type { WorkflowGraphNode } from "@/lib/workflow-graph-types";
import { cx } from "@/components/ui";

function json(value: unknown): string {
  if (value === null || value === undefined) return "なし";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "表示できないデータ";
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-3 first:border-t-0 first:pt-0">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h4>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

export function WorkflowGraphInspector({
  taskId,
  graphNode,
  nodeRun,
  workflow,
  onOpenChat,
  onOpenDiff,
  onRefresh,
  mode,
}: {
  taskId: string;
  graphNode: WorkflowGraphNode | null;
  nodeRun: WorkflowNodeView | undefined;
  workflow: WorkflowView;
  onOpenChat: (nodeId: string) => void;
  onOpenDiff: (nodeId: string) => void;
  onRefresh: () => Promise<void>;
  mode: "mobile" | "tablet" | "desktop";
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const attempt: WorkflowAttemptView | undefined = nodeRun?.attempts.at(-1);

  if (!graphNode) {
    return (
      <aside data-inspector-mode={mode === "mobile" ? "bottom-sheet" : mode === "tablet" ? "drawer" : "fixed"} className={cx("rounded-lg border border-border bg-surface p-3", mode === "mobile" && "sticky bottom-0 z-20 max-h-[45vh] overflow-auto rounded-b-none shadow-lg", mode === "tablet" && "md:absolute md:right-0 md:top-0 md:z-20 md:h-full md:max-h-full md:w-[min(22rem,calc(100%-1rem))] md:overflow-auto md:shadow-xl")} aria-label="Node Inspector">
        <h3 className="text-sm font-semibold text-text">Node Inspector</h3>
        <p className="mt-2 text-xs text-muted">CanvasまたはNode一覧からNodeを選択してください。</p>
      </aside>
    );
  }

  const isAttention = workflow.run?.status === "paused" && workflow.run.primaryNodeKey === graphNode.id;
  const canRetry = Boolean(nodeRun && workflow.run && graphNode.type.startsWith("opencode."));
  const retry = async () => {
    if (!canRetry || !workflow.run) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await sendJson("POST", `/api/tasks/${encodeURIComponent(taskId)}/workflow/nodes/${encodeURIComponent(graphNode.id)}/retry`, {
        workflowRevision: workflow.run.revision,
      });
      await onRefresh();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Retryに失敗しました。");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <aside data-inspector-mode={mode === "mobile" ? "bottom-sheet" : mode === "tablet" ? "drawer" : "fixed"} className={cx("min-w-0 rounded-lg border border-border bg-surface p-3", mode === "mobile" && "sticky bottom-0 z-20 max-h-[45vh] overflow-auto rounded-b-none shadow-lg", mode === "tablet" && "md:absolute md:right-0 md:top-0 md:z-20 md:h-full md:max-h-full md:w-[min(22rem,calc(100%-1rem))] md:overflow-auto md:shadow-xl")} aria-label="Node Inspector">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-text">{graphNode.label}</h3>
          <p className="mt-0.5 truncate text-[11px] text-muted">{graphNode.type}@{graphNode.typeVersion}</p>
        </div>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">
          {attempt?.status ?? (graphNode.type.startsWith("control.") ? "監査" : "待機中")}
        </span>
      </div>

      {isAttention && (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning-bg px-2.5 py-2 text-xs text-warning" role="status">
          <div className="flex items-center gap-1.5 font-medium"><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />Attentionが必要です</div>
          {workflow.run?.pauseReason && <p className="mt-1">{workflow.run.pauseReason}</p>}
          <button type="button" className="mt-2 underline underline-offset-2" onClick={() => onOpenChat(graphNode.id)}>Chatで回答を確認</button>
        </div>
      )}

      <div className="mt-3 space-y-3">
        <Section title="Prompt">
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2 text-[10px] text-muted">{json(attempt?.input)}</pre>
        </Section>
        <Section title="Finding / Result">
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2 text-[10px] text-muted">{json(attempt?.result)}</pre>
        </Section>
        <Section title="Artifact">
          <pre className="max-h-20 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2 text-[10px] text-muted">{json((attempt?.result as { artifacts?: unknown } | null)?.artifacts)}</pre>
        </Section>
        <Section title="Usage">
          <pre className="max-h-20 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2 text-[10px] text-muted">{json(attempt?.usageSnapshot)}</pre>
        </Section>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
        <button type="button" className={cx("inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-text hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary", !attempt?.opencodeSessionId && "cursor-not-allowed opacity-50")} disabled={!attempt?.opencodeSessionId} onClick={() => onOpenChat(graphNode.id)}>
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />Chatを開く
        </button>
        <button type="button" className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary" onClick={() => onOpenDiff(graphNode.id)}>Diffで確認</button>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-text hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary" disabled={!canRetry || retrying} onClick={() => void retry()}>
          <RefreshCw className={cx("h-3.5 w-3.5", retrying && "animate-spin")} aria-hidden="true" />{retrying ? "Retry中…" : "Retry"}
        </button>
      </div>
      {!canRetry && <p className="mt-2 text-[10px] text-muted">Control NodeはRetry対象外です。</p>}
      {retryError && <p role="alert" className="mt-2 text-xs text-danger">{retryError}</p>}
    </aside>
  );
}
