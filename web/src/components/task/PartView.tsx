"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  FileDiff,
  FilePen,
  FileText,
  Globe,
  Image as ImageIcon,
  ListTodo,
  Loader2,
  Minus,
  Paperclip,
  Search,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { Button, cx } from "@/components/ui";
import type { CostDisplayPrefs } from "@/lib/currency";
import { isTaskToolName } from "@/lib/match-child-session";
import { isImageFilePart } from "@/lib/message-parts";
import { stripMemoryInjectionBlock } from "@/lib/memory-text";
import { splitNativeImageAnalysis } from "@/lib/qwen-native-vision-text";
import { providerIdFromSubagentType } from "@/lib/subagent-provider";
import type { Part, ToolState } from "@/lib/types";
import { formatElapsed, stripGoalLoopJsonBlock } from "@/lib/useSessionStream";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { readHangTimeoutMs, subscribeHangTimeout } from "@/lib/hang-timeout";
import { Markdown } from "./Markdown";
import { NestedAgentPanel } from "./NestedAgentPanel";
import { ProviderIcon } from "./ProviderIcon";
import { MessageTokenHighlight } from "./MessageTokenHighlight";
import {
  questionInputFields,
  questionToolSummary,
} from "./tool-part-summary";

export function toolIcon(tool: string) {
  const t = tool.toLowerCase();
  if (t.includes("bash") || t.includes("shell")) return Terminal;
  if (t.includes("edit") || t.includes("write") || t.includes("patch")) return FilePen;
  if (t.includes("read")) return FileText;
  if (t.includes("glob") || t.includes("grep") || t.includes("find")) return Search;
  if (t.includes("web") || t.includes("fetch")) return Globe;
  if (t.includes("todo")) return ListTodo;
  if (t.includes("task") || t.includes("agent")) return Bot;
  return Wrench;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function shortAgentName(raw: string): string {
  // c-explore-opencode-go-kimi-k2-7-code → explore / kimi…
  const parts = raw.split("-").filter(Boolean);
  if (parts.length >= 2 && /^[a-e]$/i.test(parts[0]!)) {
    return parts.slice(1, 3).join("-");
  }
  return raw.length > 36 ? raw.slice(0, 34) + "…" : raw;
}

function elapsedForTool(state: ToolState | undefined): number | null {
  const start = state?.time?.start;
  if (typeof start !== "number") return null;
  const end = state?.time?.end;
  if (typeof end === "number") return Math.max(0, Math.round((end - start) / 1_000));
  return Math.max(0, Math.round((Date.now() - start) / 1_000));
}

export function toolSummary(tool: string, state: ToolState | undefined): string {
  if (state?.title) return state.title;
  const input = state?.input ?? {};
  const t = tool.toLowerCase();
  if (isTaskToolName(t)) {
    return (
      asString(input.description) ??
      asString(input.command) ??
      asString(input.prompt)?.slice(0, 80) ??
      "サブエージェント"
    );
  }
  if (t === "question") {
    return questionToolSummary(state);
  }
  if (t.includes("bash") || t.includes("shell")) {
    return (
      asString(input.description) ?? asString(input.command)?.slice(0, 120) ?? tool
    );
  }
  const filePath =
    asString(input.filePath) ?? asString(input.file_path) ?? asString(input.path);
  if (filePath) return filePath;
  return (
    asString(input.pattern) ??
    asString(input.url) ??
    asString(input.query) ??
    asString(input.description) ??
    tool
  );
}

/** Pull human text out of OpenCode task tool XML / JSON dumps. */
function humanizeToolOutput(raw: string): string {
  let text = raw.trim();
  if (!text) return "";

  const resultMatch = text.match(/<task_result>\s*([\s\S]*?)\s*<\/task_result>/i);
  if (resultMatch?.[1]) {
    text = resultMatch[1].trim();
  } else {
    text = text
      .replace(/<\/?task\b[^>]*>/gi, "")
      .replace(/<\/?task_result>/gi, "")
      .trim();
  }

  // Drop leftover XML/meta noise lines
  text = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*<[^>]+>\s*$/.test(line))
    .join("\n")
    .trim();

  return text;
}

type Field = { label: string; value: string };

function inputFields(tool: string, input: Record<string, unknown> | undefined): Field[] {
  if (!input) return [];
  const t = tool.toLowerCase();
  const fields: Field[] = [];
  const add = (label: string, key: string, transform?: (s: string) => string) => {
    const v = asString(input[key]);
    if (v) fields.push({ label, value: transform ? transform(v) : v });
  };

  if (t === "task" || t.includes("task")) {
    add("内容", "description");
    add("エージェント", "subagent_type", shortAgentName);
    add("指示", "prompt", (s) => (s.length > 200 ? s.slice(0, 200) + "…" : s));
    return fields;
  }
  if (t === "question") {
    return questionInputFields(input);
  }
  if (t.includes("bash") || t.includes("shell")) {
    add("説明", "description");
    add("コマンド", "command");
    return fields;
  }

  add("パス", "filePath");
  add("パス", "file_path");
  add("パス", "path");
  add("パターン", "pattern");
  add("クエリ", "query");
  add("URL", "url");
  add("説明", "description");
  return fields;
}

export function toolLabel(tool: string): string {
  const t = tool.toLowerCase();
  if (t === "task") return "サブエージェント";
  if (t === "question") return "確認";
  if (t.includes("bash") || t.includes("shell")) return "コマンド";
  if (t.includes("read")) return "読取";
  if (t.includes("write") || t.includes("edit")) return "編集";
  if (t.includes("grep") || t.includes("glob") || t.includes("find")) return "検索";
  return tool;
}

const EMPTY_TASK_CALL_IDS: string[] = [];
const ToolPartView = memo(function ToolPartView({
  part,
  directory,
  rootSessionId,
  siblingTaskCallIds = EMPTY_TASK_CALL_IDS,
  modelLabels,
  costPrefs,
  onMarkHang,
  markHangBusy = false,
}: {
  part: Part;
  directory?: string | null;
  rootSessionId?: string | null;
  siblingTaskCallIds?: string[];
  modelLabels?: Readonly<Record<string, string>>;
  costPrefs?: CostDisplayPrefs;
  onMarkHang?: () => void;
  markHangBusy?: boolean;
}) {
  const state = part.state;
  const status = state?.status ?? "pending";
  const isError = status === "error";
  const isCancelled = status === "cancelled";
  const tool = part.tool ?? "tool";
  const isShellTool = /bash|shell/i.test(tool);
  const active = status === "running" || status === "pending";
  const [hangTimeoutMs, setHangTimeoutMs] = useState(readHangTimeoutMs);
  const [elapsedSeconds, setElapsedSeconds] = useState(() => elapsedForTool(state) ?? 0);
  useEffect(() => {
    if (!active || state?.time?.start == null) return;
    const update = () => setElapsedSeconds(elapsedForTool(state) ?? 0);
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [active, state]);
  useEffect(() => {
    const onChange = () => setHangTimeoutMs(readHangTimeoutMs());
    return subscribeHangTimeout(onChange);
  }, []);
  const longRunning =
    isShellTool && active && elapsedSeconds * 1_000 >= hangTimeoutMs;
  const isTaskTool = isTaskToolName(tool);
  const nestedActive =
    isTaskTool &&
    (status === "running" || status === "pending") &&
    Boolean(directory && rootSessionId);
  const terminalTask =
    isTaskTool &&
    (status === "completed" || status === "cancelled" || status === "error") &&
    Boolean(directory && rootSessionId);
  const [open, setOpen] = useState(nestedActive || isCancelled || isError);
  const wasNestedActiveRef = useRef(false);
  useEffect(() => {
    if (nestedActive) {
      // Expand on first run start; allow collapse while still running.
      if (!wasNestedActiveRef.current) setOpen(true);
      wasNestedActiveRef.current = true;
      return;
    }
    // Reveal the nested panel once when the task finishes, even if the user
    // collapsed the header while it was still running.
    if (terminalTask && wasNestedActiveRef.current) {
      setOpen(true);
      wasNestedActiveRef.current = false;
    }
    if (isCancelled || isError) setOpen(true);
  }, [nestedActive, terminalTask, isCancelled, isError]);
  const showNested = (nestedActive || terminalTask) && open;
  const Icon = toolIcon(tool);
  const guessedProviderId = isTaskTool
    ? providerIdFromSubagentType(state?.input?.subagent_type as string | undefined)
    : null;
  const summary = toolSummary(tool, state);
  const fields = useMemo(
    () => inputFields(tool, state?.input),
    [tool, state?.input],
  );
  const rawOutput = isCancelled ? "" : state?.error || state?.output || "";
  const niceOutput = useMemo(
    () => (rawOutput ? humanizeToolOutput(rawOutput) : ""),
    [rawOutput],
  );
  const preview =
    status === "completed" && niceOutput
      ? niceOutput.replace(/\s+/g, " ").slice(0, 100)
      : status === "error" && rawOutput
        ? `エラー: ${rawOutput.replace(/\s+/g, " ").slice(0, 80)}`
        : isCancelled
          ? "中断されました"
        : nestedActive
          ? "サブエージェント実行中…"
          : terminalTask
            ? "サブエージェントの経過を表示"
            : "";
  const hasDetail =
    fields.length > 0 ||
    Boolean(niceOutput) ||
    Boolean(rawOutput) ||
    nestedActive ||
    terminalTask ||
    isCancelled ||
    isError;

  const matchHint = useMemo(
    () => ({
      callID: part.callID,
      metadata: state?.metadata ?? null,
      input: state?.input ?? null,
      siblingTaskCallIds,
    }),
    [part.callID, state?.metadata, state?.input, siblingTaskCallIds],
  );

  return (
    <div
      className={cx(
        "overflow-hidden rounded-xl border text-sm",
        status === "error" ? "border-danger/40" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        aria-expanded={hasDetail ? open : undefined}
        className={cx(
          "flex w-full items-center gap-2.5 bg-surface-2 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
          hasDetail && "cursor-pointer hover:bg-surface-3",
        )}
      >
        {guessedProviderId ? (
          <ProviderIcon
            providerID={guessedProviderId}
            className="h-4 w-4 shrink-0"
          />
        ) : (
          <Icon className="h-4 w-4 shrink-0 text-muted" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs font-medium text-muted">
              {toolLabel(tool)}
            </span>
            <span className="min-w-0 truncate text-xs text-text">{summary}</span>
          </div>
          {isCancelled && (
            <p className="mt-0.5 text-[11px] text-muted">中断されました</p>
          )}
          {preview && !open && (
            <p className="mt-0.5 truncate text-[11px] text-faint">{preview}</p>
          )}
          {active &&
            state?.time?.start != null && (
              <p className="mt-0.5 text-[11px] text-faint">
                {formatElapsed(elapsedSeconds)}
              </p>
            )}
        </div>
        {status === "running" || status === "pending" ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-working" />
        ) : status === "error" ? (
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-danger" />
        ) : isCancelled ? (
          <Minus className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0 text-success/70" />
        )}
        {hasDetail && (
          <ChevronRight
            className={cx(
              "h-3.5 w-3.5 shrink-0 text-faint transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>
      {longRunning && (
        <div
          className="flex items-start gap-2 border-t border-warning/25 bg-warning/10 px-3 py-2 text-[11px] text-warning"
          data-testid="long-running-tool-warning"
          role="status"
        >
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {Math.round(hangTimeoutMs / 60_000)}分以上実行中です。ログが増えていない場合はハングの可能性があります。
            {!onMarkHang && "必要なら上部の停止ボタンで中断できます。"}
          </span>
          {onMarkHang && (
            <Button
              variant="danger"
              size="sm"
              busy={markHangBusy}
              disabled={markHangBusy}
              aria-label="ハングと判定して停止"
              title="ハングと判定して停止"
              onClick={onMarkHang}
              className="mt-[-2px]"
            >
              ハング判定
            </Button>
          )}
        </div>
      )}
      {showNested && directory && rootSessionId && (
        <NestedAgentPanel
          directory={directory}
          parentSessionId={rootSessionId}
          active={showNested}
          matchHint={matchHint}
          modelLabels={modelLabels}
          costPrefs={costPrefs}
        />
      )}
      {open && (
        <div className="max-h-80 space-y-3 overflow-x-hidden overflow-y-auto border-t border-border bg-surface px-3 py-3">
          {fields.length > 0 && (
            <dl className="space-y-2">
              {fields.map((f) => (
                <div key={f.label}>
                  <dt className="text-[11px] font-medium text-faint">{f.label}</dt>
                  <dd className="mt-0.5 break-all whitespace-pre-wrap text-xs text-muted">
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {isCancelled && <p className="text-sm text-muted">中断されました</p>}
          {niceOutput && (
            <div
              className={cx(
                "rounded-lg px-3 py-2 text-sm",
                status === "error"
                  ? "bg-danger-bg text-danger"
                  : "bg-surface-2 text-text/90",
              )}
            >
              {status === "error" ? (
                <pre className="whitespace-pre-wrap break-words font-sans text-xs">{niceOutput}</pre>
              ) : (
                <Markdown text={niceOutput} />
              )}
            </div>
          )}
          {!niceOutput && rawOutput && (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-faint">
              {rawOutput.length > 2000 ? rawOutput.slice(0, 2000) + "\n…" : rawOutput}
            </pre>
          )}
        </div>
      )}
    </div>
  );
});

const ReasoningView = memo(function ReasoningView({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-1.5 text-xs text-faint hover:text-muted"
      >
        <Brain className="h-3.5 w-3.5" />
        思考
        <ChevronRight
          className={cx("h-3 w-3 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="mt-1.5 border-l-2 border-border pl-3 text-sm text-muted">
          <Markdown text={text} />
        </div>
      )}
    </div>
  );
});

/**
 * Collapsible panel for the image pre-analysis injected into a user message
 * when the answering model has no vision support. It is machine context rather
 * than something the user typed, so it stays folded and renders as markdown
 * instead of being dumped verbatim into the chat bubble.
 */
const NativeImageAnalysisView = memo(function NativeImageAnalysisView({
  text,
  imageIds,
}: {
  text: string;
  imageIds: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      {imageIds.length > 0 && (
        <div className="mb-2 flex flex-wrap justify-end gap-2">
          {imageIds.map((id) => (
            <FileImagePreview
              key={id}
              url={`/api/vision-attachment/${id}`}
              name="添付画像"
            />
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-1.5 text-xs text-faint hover:text-muted"
        aria-expanded={open}
      >
        <ImageIcon className="h-3.5 w-3.5" />
        画像解析結果
        <ChevronRight
          className={cx("h-3 w-3 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="md mt-2 max-h-96 overflow-y-auto rounded-lg bg-surface-2 px-3 py-2 text-left text-sm text-muted">
          <Markdown text={text} />
        </div>
      )}
    </div>
  );
});

/** Thumbnail for a sent/received image attachment, with a click-to-expand lightbox. */
function FileImagePreview({
  url,
  name,
  className,
}: {
  url: string;
  name: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useBodyScrollLock(expanded);

  useEffect(() => {
    if (!expanded) {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
      return;
    }

    const getFocusable = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    getFocusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setExpanded(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          previousFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
          setExpanded(true);
        }}
        aria-label={`${name} を拡大表示`}
        className={cx(
          "block h-28 w-28 cursor-zoom-in overflow-hidden rounded-xl border border-border bg-surface-2",
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} className="h-full w-full object-cover" />
      </button>
      {expanded && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={name}
          onClick={() => setExpanded(false)}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-6"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={name}
            className="max-h-full max-w-full cursor-zoom-out rounded-lg object-contain"
          />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded(false);
            }}
            aria-label="閉じる"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-bg/80 p-2 text-muted hover:text-text"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </>
  );
}

export const PartView = memo(function PartView({
  part,
  role,
  onFileClick,
  directory,
  rootSessionId,
  siblingTaskCallIds,
  modelLabels,
  costPrefs,
  onMarkHang,
  markHangBusy,
  skillOverviews,
  agentOverviews,
  stripGoalLoopJson,
}: {
  part: Part;
  role: "user" | "assistant";
  onFileClick?: (path: string) => void;
  directory?: string | null;
  rootSessionId?: string | null;
  siblingTaskCallIds?: string[];
  modelLabels?: Readonly<Record<string, string>>;
  costPrefs?: CostDisplayPrefs;
  onMarkHang?: () => void;
  markHangBusy?: boolean;
  /** Lowercased skill name → overview, for blue highlight + hover title. */
  skillOverviews?: ReadonlyMap<string, string>;
  /** Lowercased agent name → overview, for blue highlight + hover title. */
  agentOverviews?: ReadonlyMap<string, string>;
  /**
   * Only strip the goal-loop trailing JSON block when the session actually
   * runs a goal loop. A plain chat turn ending in a ```json block with a
   * status field must stay visible (BU-5).
   */
  stripGoalLoopJson?: boolean;
}) {
  switch (part.type) {
    case "text": {
      const raw = part.text ?? "";
      // The goal loop asks the model to emit a trailing ```json result block;
      // it is internal bookkeeping, not chat content. Only strips a trailing
      // block whose parsed object looks like a goal result.
      const text =
        role === "assistant" && stripGoalLoopJson
          ? stripGoalLoopJsonBlock(raw)
          : raw;
      // The first goal-loop user message carries a `<workspace-memory>` prefix
      // block that is internal context, not chat content. Hide it at render.
      const shown = role === "user" ? stripMemoryInjectionBlock(text) : text;
      if (!shown.trim()) return null;
      if (role === "user") {
        // The vision pre-analysis is appended to the user text before send; it
        // is internal context, so it renders as a folded panel, not chat text.
        const { request, analysis, imageIds } = splitNativeImageAnalysis(shown);
        return (
          <div className="ml-auto min-w-0 max-w-[88%] rounded-2xl rounded-br-md bg-surface-3 px-4 py-2.5">
            {request.trim() && (
              <div className="md min-w-0 text-[0.925rem] whitespace-pre-wrap break-words">
                <MessageTokenHighlight
                  text={request}
                  skills={skillOverviews}
                  agents={agentOverviews}
                />
              </div>
            )}
            <NativeImageAnalysisView text={analysis} imageIds={imageIds} />
          </div>
        );
      }
      return <Markdown text={text} />;
    }
    case "reasoning":
      return <ReasoningView text={part.text ?? ""} />;
    case "tool":
      return (
        <ToolPartView
          part={part}
          directory={directory}
          rootSessionId={rootSessionId}
          siblingTaskCallIds={siblingTaskCallIds}
          modelLabels={modelLabels}
          costPrefs={costPrefs}
          onMarkHang={onMarkHang}
          markHangBusy={markHangBusy}
        />
      );
    case "file": {
      const name = part.filename ?? "file";
      if (isImageFilePart(part)) {
        return (
          <FileImagePreview
            url={part.url}
            name={name}
            className={role === "user" ? "ml-auto" : undefined}
          />
        );
      }
      return (
        <button
          type="button"
          onClick={() => onFileClick?.(name)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-xs text-muted hover:text-text"
        >
          <Paperclip className="h-3 w-3" />
          {name}
        </button>
      );
    }
    case "patch": {
      const files = part.files ?? [];
      if (files.length === 0) return null;
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-xs text-faint">
            <FileDiff className="h-3.5 w-3.5" />
            変更:
          </span>
          {files.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onFileClick?.(f)}
              className="cursor-pointer rounded-full border border-border bg-surface-2 px-2.5 py-0.5 font-mono text-xs text-muted hover:text-text"
            >
              {f.split(/[\\/]/).pop()}
            </button>
          ))}
        </div>
      );
    }
    case "agent":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs text-muted">
          <Bot className="h-3 w-3" />
          {part.name ?? "agent"}
        </span>
      );
    case "retry":
    case "error": {
      // The engine reports provider failures as a `retry` part whose `error`
      // carries the APIError detail; older engine generations used a plain
      // `error` part with the text directly. Render both so the provider
      // message is never silently dropped.
      const rawError = part.error?.data?.message;
      const detail = rawError
        ? part.error?.data?.statusCode
          ? `HTTP ${part.error.data.statusCode}: ${rawError}`
          : rawError
        : (part.metadata?.message as string | undefined) ||
          part.text ||
          "エラーが発生しました";
      return (
        <div
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger"
        >
          <span className="min-w-0 whitespace-pre-wrap break-words">
            {detail}
          </span>
        </div>
      );
    }
    default:
      return null;
  }
});
