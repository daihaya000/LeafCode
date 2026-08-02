import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  CircleOff,
  Loader2,
  PauseCircle,
  TriangleAlert,
} from "lucide-react";
import type { WorkflowGraphReactNode } from "@/lib/workflow-graph-react-flow";
import { cx } from "@/components/ui";

function statusLabel(status: string): string {
  if (status === "succeeded" || status === "completed") return "完了";
  if (["creating_session", "running", "dispatching"].includes(status)) return "実行中";
  if (status === "paused") return "一時停止";
  if (status === "failed") return "失敗";
  if (status === "skipped") return "スキップ";
  if (status === "disabled") return "無効";
  if (status === "unsupported") return "未対応";
  return "待機中";
}

function StatusIcon({ status, reducedMotion }: { status: string; reducedMotion: boolean }) {
  const className = cx(
    "h-4 w-4 shrink-0",
    !reducedMotion && ["creating_session", "running", "dispatching"].includes(status)
      ? "animate-spin"
      : undefined,
  );
  if (status === "succeeded" || status === "completed") {
    return <CheckCircle2 className={cx(className, "text-success")} aria-hidden="true" />;
  }
  if (["creating_session", "running", "dispatching"].includes(status)) {
    return <Loader2 className={cx(className, "text-working")} aria-hidden="true" />;
  }
  if (status === "failed") return <AlertCircle className={cx(className, "text-danger")} aria-hidden="true" />;
  if (status === "paused") return <PauseCircle className={cx(className, "text-warning")} aria-hidden="true" />;
  if (status === "unsupported") return <TriangleAlert className={cx(className, "text-warning")} aria-hidden="true" />;
  if (status === "skipped" || status === "disabled") return <CircleOff className={cx(className, "text-muted")} aria-hidden="true" />;
  return <Circle className={cx(className, "text-faint")} aria-hidden="true" />;
}

function statusAccent(status: string, attention: boolean): string {
  if (attention || status === "paused") return "border-l-warning";
  if (status === "succeeded" || status === "completed") return "border-l-success";
  if (["creating_session", "running", "dispatching"].includes(status)) return "border-l-working";
  if (status === "failed") return "border-l-danger";
  if (status === "unsupported") return "border-l-warning";
  return "border-l-border-strong";
}

function nodeMeta(data: WorkflowGraphReactNode["data"]): string {
  if (!data.definition) return data.graphNode.type;
  return `${data.definition.category} · ${data.definition.runtime === "opencode_session" ? "session" : "control"}`;
}

export function WorkflowGraphNode({ data }: NodeProps<WorkflowGraphReactNode>) {
  const inputs = data.definition?.inputs ?? [];
  const outputs = data.definition?.outputs ?? [];
  const statusText = statusLabel(data.status);
  return (
    <div
      aria-label={`${data.graphNode.label}、${statusLabel(data.status)}`}
      aria-disabled={data.unsupported || data.graphNode.disabled ? "true" : undefined}
      className={cx(
        "relative min-w-52 rounded-xl border border-l-4 bg-surface px-3 py-2.5 text-text shadow-sm transition-shadow",
        data.unsupported ? "border-warning/60 bg-warning-bg" : "border-border",
        statusAccent(data.status, data.attention),
        data.graphNode.disabled && "opacity-65",
        data.attention && "ring-2 ring-warning/50",
        !data.unsupported && "hover:shadow-md",
      )}
    >
      {inputs.map((port) => (
        <Handle
          key={`input-${port.id}`}
          id={port.id}
          type="target"
          position={Position.Left}
          className="workflow-graph-handle"
          aria-label={`${data.graphNode.label} ${port.label}入力`}
        />
      ))}
      {outputs.map((port) => (
        <Handle
          key={`output-${port.id}`}
          id={port.id}
          type="source"
          position={Position.Right}
          className="workflow-graph-handle"
          aria-label={`${data.graphNode.label} ${port.label}出力`}
        />
      ))}
      <div className="flex items-start gap-2">
        <StatusIcon status={data.status} reducedMotion={data.reducedMotion} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-xs font-semibold">{data.graphNode.label}</h3>
            <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{statusText}</span>
          </div>
          <p className="mt-1 truncate text-[10px] capitalize text-muted">{nodeMeta(data)}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-faint">
        <span>{data.unsupported ? "実行不可" : `Attempt ${data.attemptNo || "—"}`}</span>
        {data.dispatchStatus && <span className="truncate">{data.dispatchStatus}</span>}
      </div>
      {data.attention && (
        <p className="mt-2 rounded-md bg-warning-bg px-2 py-1 text-[10px] text-warning">
          確認が必要です
        </p>
      )}
    </div>
  );
}
