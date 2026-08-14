"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  ArrowDownToLine,
  ChevronDown,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui";
import { sendJson } from "@/lib/client";
import {
  NEXT_ACTION_PREVIOUS_MAX_COUNT,
  parseSuggestions,
} from "@/lib/next-action-text";

type NextActionState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; suggestions: string[] }
  | { kind: "error"; message: string };

export type NextActionProps = {
  taskId: string;
  sessionId: string;
  /** Currently selected model key (providerID::modelID) in the composer. */
  model?: string;
  /** Currently selected agent in the composer. */
  agent?: string;
  /** Called when the user accepts a suggestion. Must NOT send the prompt. */
  onApply: (suggestion: string) => void;
  /** Optional invalidation key — when it changes, reset to idle. */
  invalidateKey?: string | number;
  /**
   * Whether the viewport is at least `md`. When true (default) the component
   * behaves as before: the success state is always expanded and no collapse
   * toggle is rendered. When false (mobile) the success state can be
   * collapsed to save space.
   */
  isMd?: boolean;
};

const panelClass = "mt-2";
const quietPanelClass =
  "mt-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2";

function PanelMark({ busy = false }: { busy?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
    </span>
  );
}

function PanelIntro({
  title,
  description,
  busy = false,
}: {
  title: string;
  description?: string;
  busy?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <PanelMark busy={busy} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-text">{title}</p>
        {description && (
          <p className="mt-0.5 text-[11px] leading-4 text-muted">{description}</p>
        )}
      </div>
    </div>
  );
}

/**
 * NextAction UI: generates next-action suggestion(s) from the current
 * session's conversation and offers them to the user for manual application
 * to the composer. Never auto-sends.
 *
 * The user can request 1–3 suggestions per generation. Multiple suggestions
 * are displayed individually, each with its own "apply to composer" button.
 * On regeneration every suggestion shown so far is sent back as an exclusion
 * so the model produces different proposals.
 */
export function NextAction({
  taskId,
  sessionId,
  model,
  agent,
  onApply,
  invalidateKey,
  isMd = true,
}: NextActionProps) {
  const [state, setState] = useState<NextActionState>({ kind: "idle" });
  // Suggestions already shown for the current conversation state. Sent back
  // on regeneration so the API can tell the model to avoid repeating them.
  const [previousSuggestions, setPreviousSuggestions] = useState<string[]>([]);
  // Keep the chosen card visibly acknowledged until the conversation changes
  // or another generation replaces the result.
  const [appliedIndex, setAppliedIndex] = useState<number | null>(null);
  // Mobile-only collapse for the success state. Desktop (isMd=true) always
  // renders the suggestions expanded and never shows the toggle.
  const [collapsed, setCollapsed] = useState(false);
  const panelId = useId();
  const contextRef = useRef({ taskId, sessionId, invalidateKey });
  const generationRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  // Reset to idle when the invalidation key changes (conversation updated,
  // revert, or task switch). Previously shown suggestions belong to the old
  // conversation state, so drop them too. On mobile the success panel is
  // collapsed again so the next generation starts fresh.
  useEffect(() => {
    const previous = contextRef.current;
    if (
      previous.taskId === taskId &&
      previous.sessionId === sessionId &&
      previous.invalidateKey === invalidateKey
    ) {
      return;
    }
    contextRef.current = { taskId, sessionId, invalidateKey };
    // Invalidate an in-flight generation before clearing the old suggestion.
    generationRef.current += 1;
    setPreviousSuggestions([]);
    setAppliedIndex(null);
    setState({ kind: "idle" });
    if (!isMd) setCollapsed(true);
  }, [taskId, sessionId, invalidateKey, isMd]);

  const generate = useCallback(async () => {
    if (!mountedRef.current) return;
    const generation = ++generationRef.current;
    setAppliedIndex(null);
    setState({ kind: "loading" });
    try {
      const body: Record<string, unknown> = { sessionId };
      if (model) {
        const [providerID, modelID] = model.split("::");
        if (providerID && modelID) {
          body.model = { providerID, modelID };
        }
      }
      if (agent) body.agent = agent;
      // Regeneration: tell the API which suggestions were already shown so
      // the model can produce different ones. Omitted on initial generation.
      if (previousSuggestions.length > 0) {
        body.previousSuggestions = previousSuggestions;
      }
      const res = await sendJson<{
        suggestion?: unknown;
        suggestions?: unknown;
      }>("POST", `/api/tasks/${taskId}/next-action`, body);
      const suggestions = parseSuggestions(res);
      if (suggestions.length === 0) {
        throw new Error("empty suggestions");
      }
      if (!mountedRef.current || generation !== generationRef.current) return;
      // Remember everything shown so far so the next regeneration can
      // exclude all of them (capped to keep the prompt bounded).
      setPreviousSuggestions((prev) => {
        const next = [...prev];
        for (const s of suggestions) {
          if (!next.includes(s)) next.push(s);
        }
        return next.length > NEXT_ACTION_PREVIOUS_MAX_COUNT
          ? next.slice(next.length - NEXT_ACTION_PREVIOUS_MAX_COUNT)
          : next;
      });
      // A fresh generation is always shown expanded, even on mobile.
      setCollapsed(false);
      setState({ kind: "success", suggestions });
    } catch (err) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      console.warn("[NextAction] generate failed", err);
      setState({
        kind: "error",
        // Never surface raw server messages — always show the fixed
        // Japanese string per spec 5.2.
        message: "提案の生成に失敗しました。",
      });
    }
  }, [taskId, sessionId, model, agent, previousSuggestions]);

  if (state.kind === "idle") {
    return (
      <section className={panelClass} aria-label="次の一手">
        <Button
          variant="secondary"
          size="sm"
          onClick={generate}
          aria-label="次の指示を提案"
          className="w-full sm:w-auto"
        >
          <Sparkles className="h-3.5 w-3.5" />
          次の指示を提案
        </Button>
      </section>
    );
  }

  if (state.kind === "loading") {
    return (
      <div
        className={quietPanelClass}
        aria-label="次の一手"
        aria-busy="true"
      >
        <div className="px-1 py-0">
          <PanelIntro
            title="次の一手を準備中"
            description="会話の文脈から、実行しやすい指示を整理しています。"
            busy
          />
          <div
            className="mt-3 flex items-center gap-2 text-xs text-muted"
            aria-busy="true"
          >
            <span
              role="status"
              className="inline-flex items-center gap-1.5"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
              提案を作成中…
            </span>
            <span aria-hidden="true" className="text-faint">
              ·
            </span>
            <span>しばらくお待ちください</span>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div
        className={quietPanelClass}
        aria-label="次の一手"
      >
        <div className="px-1 pt-0">
          <PanelIntro
            title="次の一手を生成できませんでした"
            description="会話の内容は変わっていません。もう一度試せます。"
          />
        </div>
        <div
          className="mt-3 flex flex-col gap-3 border-t border-danger/30 bg-danger-bg px-3 py-3 sm:flex-row sm:items-center sm:px-4"
          role="alert"
        >
          <p className="min-w-0 flex-1 text-sm text-danger">{state.message}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={generate}
            aria-label="再試行"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            再試行
          </Button>
        </div>
      </div>
    );
  }

  // success
  const multiple = state.suggestions.length > 1;
  // Desktop keeps the legacy layout: always expanded, no toggle. Mobile
  // (isMd=false) renders a disclosure header so the suggestions list and
  // regenerate button can be collapsed out of the DOM to save space.
  const collapsible = !isMd;
  const isCollapsed = collapsible && collapsed;
  return (
    <section className={panelClass} aria-label="次の一手">
      <div className="flex items-start gap-2 px-1 pt-0">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={!isCollapsed}
            aria-controls={panelId}
            aria-label={isCollapsed ? "次の指示を展開" : "次の指示を折りたたむ"}
            onClick={() => setCollapsed((value) => !value)}
            className="flex min-h-9 min-w-0 flex-1 items-start gap-2 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          >
            <PanelMark />
            <span className="min-w-0 flex-1 pt-0.5">
              <span className="block text-xs font-medium text-text">
                次の指示
              </span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-muted transition-transform ${isCollapsed ? "-rotate-90" : ""} motion-reduce:transition-none`}
            />
          </button>
        ) : (
          <PanelIntro title="次の指示" />
        )}
      </div>
      {!isCollapsed && (
        <div
          id={panelId}
          aria-live="polite"
          className="mt-2 border-t border-border px-1 pt-2"
        >
          <div
            role="list"
            aria-label="次の指示の提案一覧"
            className="flex flex-col gap-2"
          >
            {state.suggestions.map((suggestion, i) => (
              <div
                key={`${i}-${suggestion}`}
                role="listitem"
                className="rounded-xl border border-border bg-surface-2 p-3 transition-colors hover:border-border-strong hover:bg-surface-3 sm:p-4 motion-reduce:transition-none"
              >
                <div className="flex items-start gap-3">
                  {multiple && (
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-xs font-semibold text-muted"
                    >
                      {i + 1}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    {multiple && (
                      <p className="mb-1 text-[11px] font-medium text-faint">
                        提案 {i + 1}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap text-sm leading-6 text-text">
                      {suggestion}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex sm:justify-end">
                  <Button
                    variant={appliedIndex === i ? "secondary" : "primary"}
                    size="sm"
                    onClick={() => {
                      onApply(suggestion);
                      setAppliedIndex(i);
                    }}
                    aria-label={
                      appliedIndex === i
                        ? multiple
                          ? `入力欄に追加済み ${i + 1}`
                          : "入力欄に追加済み"
                        : multiple
                          ? `入力欄に入れる ${i + 1}`
                          : "入力欄に入れる"
                    }
                    className={`w-full sm:w-auto ${appliedIndex === i ? "border border-success/30 text-success" : ""}`}
                  >
                    {appliedIndex === i ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowDownToLine className="h-3.5 w-3.5" />
                    )}
                    {appliedIndex === i ? "入力欄に追加済み" : "入力欄に入れる"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] leading-5 text-faint">
              違う場合は再生成できます。
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={generate}
              aria-label="再生成"
              className="w-full sm:w-auto"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              再生成
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
