import { useEffect, useRef, useState } from "react";
import { MessageSquare, RefreshCw, TriangleAlert, X } from "lucide-react";
import { sendJson } from "@/lib/client";
import { isWorkflowGraphEditEnabled } from "@/lib/workflow-feature";
import type { WorkflowAttemptView, WorkflowNodeView, WorkflowView } from "@/lib/workflow-service";
import type { WorkflowGraphNode } from "@/lib/workflow-graph-types";
import { WORKFLOW_NODE_REGISTRY } from "@/lib/workflow-node-registry";
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
  onClose,
  mode,
  graphRevision,
  editingEnabled = true,
}: {
  taskId: string;
  graphNode: WorkflowGraphNode | null;
  graphRevision?: number;
  editingEnabled?: boolean;
  nodeRun: WorkflowNodeView | undefined;
  workflow: WorkflowView;
  onOpenChat: (nodeId: string) => void;
  onOpenDiff: (nodeId: string) => void;
  onRefresh: () => Promise<void>;
  onClose?: () => void;
  mode: "mobile" | "tablet" | "desktop";
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [configDraft, setConfigDraft] = useState("{}");
  const [disabledDraft, setDisabledDraft] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaved, setEditSaved] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [selectedAttemptNo, setSelectedAttemptNo] = useState<number | null>(null);
  const previousNodeId = useRef<string | null>(null);
  const attemptEntries = (nodeRun?.attempts ?? []).map((entry, index) => ({
    attempt: entry,
    number: entry.attemptNo || index + 1,
  }));
  const selectedAttempt = selectedAttemptNo === null
    ? attemptEntries.at(-1)
    : attemptEntries.find((entry) => entry.number === selectedAttemptNo) ?? attemptEntries.at(-1);
  const attempt: WorkflowAttemptView | undefined = selectedAttempt?.attempt;
  const editEnabled = editingEnabled && graphRevision !== undefined && isWorkflowGraphEditEnabled();

  useEffect(() => {
    if (!graphNode || graphNode.id === previousNodeId.current) return;
    previousNodeId.current = graphNode.id;
    setLabelDraft(graphNode.label);
    setConfigDraft(json(graphNode.config));
    setDisabledDraft(graphNode.disabled);
    setEditError(null);
    setEditSaved(false);
    setSelectedAttemptNo(null);
  }, [graphNode]);

  useEffect(() => {
    if (!graphNode || !onClose) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [graphNode, onClose]);

  if (!graphNode) {
    return (
      <aside data-inspector-mode={mode === "mobile" ? "bottom-sheet" : mode === "tablet" ? "drawer" : "fixed"} className={cx("rounded-lg border border-border bg-surface p-3", mode === "mobile" && "sticky bottom-0 z-20 max-h-[45vh] overflow-auto rounded-b-none shadow-lg", mode === "tablet" && "md:absolute md:right-0 md:top-0 md:z-20 md:h-full md:max-h-full md:w-[min(22rem,calc(100%-1rem))] md:overflow-auto md:shadow-xl")} aria-label="Node Inspector">
        <h3 className="text-sm font-semibold text-text">Node Inspector</h3>
        <p className="mt-2 text-xs text-muted">CanvasまたはNode一覧からNodeを選択してください。</p>
      </aside>
    );
  }

  const isAttention = workflow.run?.status === "paused" && workflow.run.primaryNodeKey === graphNode.id;
  const definition = WORKFLOW_NODE_REGISTRY.get(graphNode.type, graphNode.typeVersion);
  const runIsActive = Boolean(workflow.run && !["completed", "failed", "stopped", "detached"].includes(workflow.run.status));
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

  const saveEdit = async () => {
    if (!editEnabled || graphRevision === undefined) return;
    let config: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(configDraft);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("ConfigはJSONオブジェクトで入力してください。");
      config = parsed as Record<string, unknown>;
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Config JSONを確認してください。");
      return;
    }
    if (!labelDraft.trim()) {
      setEditError("Nodeラベルを入力してください。");
      return;
    }
    setSavingEdit(true);
    setEditError(null);
    setEditSaved(false);
    try {
      await sendJson("PATCH", `/api/tasks/${encodeURIComponent(taskId)}/workflow/graph`, {
        expectedGraphRevision: graphRevision,
        operations: [
          { op: "set_node_label", nodeId: graphNode.id, label: labelDraft.trim() },
          { op: "update_node_config", nodeId: graphNode.id, config },
          { op: "set_node_disabled", nodeId: graphNode.id, disabled: disabledDraft },
        ],
      });
      await onRefresh();
      setEditSaved(true);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Node設定の保存に失敗しました。");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <aside data-inspector-mode={mode === "mobile" ? "bottom-sheet" : mode === "tablet" ? "drawer" : "fixed"} className={cx("min-w-0 rounded-lg border border-border bg-surface p-3", mode === "mobile" && "sticky bottom-0 z-20 max-h-[45vh] overflow-auto rounded-b-none shadow-lg", mode === "tablet" && "md:absolute md:right-0 md:top-0 md:z-20 md:h-full md:max-h-full md:w-[min(22rem,calc(100%-1rem))] md:overflow-auto md:shadow-xl")} aria-label="Node Inspector">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-text">{graphNode.label}</h3>
          <p className="mt-0.5 truncate text-[11px] text-muted">{graphNode.type}@{graphNode.typeVersion}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">
            {attempt?.status ?? (graphNode.type.startsWith("control.") ? "監査" : "待機中")}
          </span>
          {onClose && <button type="button" aria-label="Inspectorを閉じる" aria-keyshortcuts="Escape" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-primary"><X className="h-4 w-4" aria-hidden="true" /></button>}
        </div>
      </div>

      {isAttention && (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning-bg px-2.5 py-2 text-xs text-warning" role="status">
          <div className="flex items-center gap-1.5 font-medium"><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />Attentionが必要です</div>
          {workflow.run?.pauseReason && <p className="mt-1">{workflow.run.pauseReason}</p>}
          <button type="button" className="mt-2 underline underline-offset-2" onClick={() => onOpenChat(graphNode.id)}>Chatで回答を確認</button>
        </div>
      )}

      <div className="mt-3 space-y-3">
        <Section title="Registry">
          <div className="rounded-md bg-surface-2 p-2 text-[10px] text-muted">
            <p className="font-medium text-text">{definition?.displayName ?? "未対応Node"}</p>
            {definition?.description && <p className="mt-1 leading-relaxed">{definition.description}</p>}
            <p className="mt-1">{definition ? `${definition.category} · ${definition.runtime}` : `${graphNode.type}@${graphNode.typeVersion}`}</p>
          </div>
        </Section>
        <Section title="Node設定">
          <div className="space-y-2">
            {editEnabled && runIsActive && <p className="inline-flex rounded-full border border-primary/30 bg-primary/5 px-2 py-1 text-[10px] font-medium text-primary">Draft編集 · 次回実行から適用</p>}
            <label className="block text-[10px] text-muted">ラベル
              <input aria-label="Node label" value={labelDraft} disabled={!editEnabled || savingEdit} onChange={(event) => setLabelDraft(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-text disabled:opacity-50" />
            </label>
            <label className="block text-[10px] text-muted">Config JSON
              <textarea aria-label="Node config JSON" value={configDraft} disabled={!editEnabled || savingEdit} onChange={(event) => setConfigDraft(event.target.value)} rows={6} spellCheck={false} className="mt-1 w-full resize-y rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[10px] text-text disabled:opacity-50" />
            </label>
            <label className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-xs text-text">
              <input type="checkbox" aria-label="Nodeを無効化" checked={disabledDraft} disabled={!editEnabled || savingEdit} onChange={(event) => setDisabledDraft(event.target.checked)} className="h-4 w-4 accent-primary" />
              このNodeを無効化する
            </label>
            {editEnabled && <button type="button" disabled={savingEdit} onClick={() => void saveEdit()} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text hover:bg-surface-2 disabled:opacity-50">{savingEdit ? "保存中…" : "Node設定を保存"}</button>}
            {editError && <p role="alert" className="text-xs text-danger">{editError}</p>}
            {editSaved && <p role="status" className="text-xs text-success">Node設定を保存しました。</p>}
          </div>
        </Section>
        {attemptEntries.length > 0 && (
          <Section title="Attempt履歴">
            <label className="block text-[10px] text-muted">表示するAttempt
              <select aria-label="表示するAttempt" value={String(selectedAttempt?.number ?? "")} onChange={(event) => setSelectedAttemptNo(Number(event.target.value))} className="mt-1 min-h-10 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-text">
                {attemptEntries.map((entry) => <option key={`${entry.number}-${entry.attempt.id ?? "attempt"}`} value={entry.number}>Attempt {entry.number} · {entry.attempt.status}</option>)}
              </select>
            </label>
          </Section>
        )}
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
