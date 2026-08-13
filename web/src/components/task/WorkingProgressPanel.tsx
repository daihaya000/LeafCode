import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Circle,
  CircleAlert,
  ListTodo,
  Loader2,
  Minus,
} from "lucide-react";
import { cx } from "@/components/ui";
import { formatElapsed } from "@/lib/useSessionStream";
import type {
  MessageWithParts,
  SessionStatus,
  Todo,
  ToolState,
} from "@/lib/types";
import { toolIcon, toolLabel, toolSummary } from "./PartView";
export type WorkStep = {
  id: string;
  tool: string;
  title: string;
  status: ToolState["status"];
  durationSec: number | null;
};

type WorkDetail = {
  kind: "retry" | "tool" | "reasoning" | "waiting";
  activeSteps: WorkStep[];
  doneSteps: WorkStep[];
  todoDone: number;
  todoTotal: number;
  todos: Todo[];
};

/**
 * Collect the current turn's tool parts. The turn is the last assistant
 * message; when that message is pure text (the model is generating a reply
 * after tool calls), the tool parts that produced it live in the previous
 * assistant message, so include that one as well.
 */
function stepDurationSec(state: ToolState | undefined, now: number): number | null {
  const start = state?.time?.start;
  if (typeof start !== "number") return null;
  const end = state?.time?.end;
  if (typeof end === "number") return Math.max(0, Math.round((end - start) / 1_000));
  return Math.max(0, Math.round((now - start) / 1_000));
}

function collectWorkSteps(
  messages: MessageWithParts[],
  now: number,
): { activeSteps: WorkStep[]; doneSteps: WorkStep[]; reasoning: boolean } {
  const activeSteps: WorkStep[] = [];
  const doneSteps: WorkStep[] = [];

  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.info.role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx < 0) {
    return { activeSteps, doneSteps, reasoning: false };
  }

  const scopeStart = lastAssistantIdx > 0 ? lastAssistantIdx - 1 : lastAssistantIdx;
  for (let i = lastAssistantIdx; i >= scopeStart; i--) {
    const m = messages[i];
    if (!m) continue;
    for (let j = m.parts.length - 1; j >= 0; j--) {
      const p = m.parts[j];
      if (!p || p.type !== "tool" || !p.tool) continue;
      const st = p.state?.status ?? "pending";
      const step: WorkStep = {
        id: p.id,
        tool: p.tool,
        title: p.state?.title ?? toolSummary(p.tool, p.state),
        status: st,
        durationSec: stepDurationSec(p.state, now),
      };
      if (st === "running" || st === "pending") {
        activeSteps.push(step);
      } else if (st === "completed" || st === "error" || st === "cancelled") {
        doneSteps.push(step);
      }
    }
  }

  // Reasoning is in flight only while the last assistant message ends with a
  // reasoning part and carries neither text nor tool parts yet.
  const lastMsg = messages[lastAssistantIdx];
  let reasoning = false;
  if (lastMsg) {
    const last = lastMsg.parts[lastMsg.parts.length - 1];
    const hasText = lastMsg.parts.some(
      (p) => p.type === "text" && Boolean((p.text ?? "").trim()),
    );
    const hasTool = lastMsg.parts.some((p) => p.type === "tool");
    reasoning = last?.type === "reasoning" && !hasText && !hasTool;
  }
  return { activeSteps, doneSteps, reasoning };
}

function kindLabel(kind: WorkDetail["kind"]): string {
  switch (kind) {
    case "retry":
      return "リトライ中";
    case "tool":
      return "ツール実行中";
    case "reasoning":
      return "推論中";
    case "waiting":
      return "モデル応答待ち";
  }
}

function elapsedColor(ms: number): string {
  return ms >= 60_000 ? "text-danger" : ms >= 30_000 ? "text-warning" : "text-faint";
}

/**
 * Inline collapsible progress panel shown while the agent is working.
 * The full aggregation only runs while the panel is expanded.
 */
export const WorkingProgressPanel = ({
  status,
  messages,
  todos,
  mutationElapsedMs,
  currentTool = null,
}: {
  status: SessionStatus | null;
  messages: MessageWithParts[];
  todos: Todo[];
  mutationElapsedMs: number | null;
  /** Lightweight one-liner for the collapsed header (already computed by the parent). */
  currentTool?: string | null;
}) => {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [open]);

  const detail = useMemo<WorkDetail | null>(() => {
    if (!open) return null;
    const { activeSteps, doneSteps, reasoning } = collectWorkSteps(messages, now);
    const todoDone = todos.filter((t) => t.status === "completed").length;
    let kind: WorkDetail["kind"];
    if (status?.type === "retry") kind = "retry";
    else if (activeSteps.length > 0) kind = "tool";
    else if (reasoning) kind = "reasoning";
    else kind = "waiting";
    return {
      kind,
      activeSteps,
      doneSteps,
      todoDone,
      todoTotal: todos.length,
      todos,
    };
  }, [open, status, messages, todos, now]);

  const headline = detail
    ? detail.kind === "retry"
      ? `リトライ中: ${status?.message ?? "再試行中"}`
      : detail.kind === "tool"
        ? "ツール実行中"
        : detail.kind === "reasoning"
          ? "推論中…"
          : "モデル応答待ち…"
    : status?.type === "retry"
      ? `リトライ中… ${status?.message ?? ""}`
      : currentTool
        ? `${currentTool}…`
        : "作業中…";

  const elapsedMs =
    mutationElapsedMs != null && mutationElapsedMs > 0 ? mutationElapsedMs : null;

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-working" />
        <span className="min-w-0 flex-1 truncate text-left">{headline}</span>
        {elapsedMs != null && (
          <span className={cx("shrink-0 text-xs", elapsedColor(elapsedMs))}>
            ({formatElapsed(Math.floor(elapsedMs / 1_000))})
          </span>
        )}
        <ChevronRight
          className={cx(
            "h-3.5 w-3.5 shrink-0 text-faint transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && detail && (
        <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface-2">
          <div className="flex items-center gap-2 px-3 pt-2.5 text-xs">
            <span
              data-testid="working-kind-badge"
              className="rounded-full bg-working/15 px-2 py-0.5 font-medium text-working"
            >
              {kindLabel(detail.kind)}
            </span>
            {detail.activeSteps.length > 0 && (
              <span className="text-faint">実行中 {detail.activeSteps.length} 件</span>
            )}
            {elapsedMs != null && (
              <span className={cx("ml-auto shrink-0 font-mono", elapsedColor(elapsedMs))}>
                {formatElapsed(Math.floor(elapsedMs / 1_000))}
              </span>
            )}
          </div>
          {detail.activeSteps.length > 0 && (
            <section className="mt-2 px-3">
              <h4 className="text-[11px] font-medium text-faint">実行中ツール</h4>
              <ul className="mt-1 space-y-1">
                {detail.activeSteps.map((s) => {
                  const Icon = toolIcon(s.tool);
                  return (
                    <li key={s.id} className="flex items-center gap-2 text-xs">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted" />
                      <span className="shrink-0 text-faint">{toolLabel(s.tool)}</span>
                      <span className="min-w-0 flex-1 truncate text-text" title={s.title}>
                        {s.title}
                      </span>
                      {s.durationSec != null && (
                        <span className="shrink-0 font-mono text-faint">
                          {formatElapsed(s.durationSec)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {detail.doneSteps.length > 0 && (
            <section className="mt-2 px-3 pb-3">
              <h4 className="text-[11px] font-medium text-faint">
                完了ステップ（{detail.doneSteps.length}）
              </h4>
              <ul className="mt-1 space-y-1">
                {detail.doneSteps.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-xs">
                    {s.status === "error" ? (
                      <CircleAlert className="h-3.5 w-3.5 shrink-0 text-danger" />
                    ) : s.status === "cancelled" ? (
                      <Minus className="h-3.5 w-3.5 shrink-0 text-muted" />
                    ) : (
                      <Check className="h-3.5 w-3.5 shrink-0 text-success/70" />
                    )}
                    <span className="shrink-0 text-faint">{toolLabel(s.tool)}</span>
                    <span className="min-w-0 flex-1 truncate text-text" title={s.title}>
                      {s.title}
                    </span>
                    {s.durationSec != null && (
                      <span className="shrink-0 font-mono text-faint">
                        {formatElapsed(s.durationSec)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {detail.todoTotal > 0 && (
            <section className="border-t border-border/60 px-3 py-2.5">
              <h4 className="flex items-center gap-1.5 text-[11px] font-medium text-faint">
                <ListTodo className="h-3 w-3" />
                ToDo {detail.todoDone}/{detail.todoTotal}
              </h4>
              <ul className="mt-1 space-y-1">
                {detail.todos.map((t, i) => (
                  <li key={t.id ?? i} className="flex items-center gap-2 text-xs text-muted">
                    {t.status === "completed" ? (
                      <Check className="h-3 w-3 shrink-0 text-success/70" />
                    ) : t.status === "in_progress" ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-working" />
                    ) : t.status === "cancelled" ? (
                      <Minus className="h-3 w-3 shrink-0 text-muted" />
                    ) : (
                      <Circle className="h-3 w-3 shrink-0 text-faint" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {t.content ?? `タスク ${i + 1}`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
