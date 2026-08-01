"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  ArrowDownToLine,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui";
import { sendJson } from "@/lib/client";
import {
  NEXT_ACTION_COUNT_DEFAULT,
  NEXT_ACTION_COUNT_MAX,
  NEXT_ACTION_COUNT_MIN,
  NEXT_ACTION_PREVIOUS_MAX_COUNT,
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

/** Parse the API response, preferring `suggestions` and falling back to the legacy `suggestion` field. */
function parseSuggestions(res: {
  suggestion?: unknown;
  suggestions?: unknown;
}): string[] {
  const out: string[] = [];
  if (Array.isArray(res.suggestions)) {
    for (const s of res.suggestions) {
      if (typeof s === "string" && s.trim() && !out.includes(s)) out.push(s);
    }
  }
  if (
    out.length === 0 &&
    typeof res.suggestion === "string" &&
    res.suggestion.trim()
  ) {
    out.push(res.suggestion);
  }
  return out;
}

/**
 * Native select for the number of suggestions to request (1–3). The choice
 * is transient component state — it is never persisted.
 */
function CountSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const options: number[] = [];
  for (let n = NEXT_ACTION_COUNT_MIN; n <= NEXT_ACTION_COUNT_MAX; n++) {
    options.push(n);
  }
  return (
    <select
      aria-label="提案の件数"
      value={String(value)}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      className="h-8 shrink-0 cursor-pointer rounded-lg border border-border bg-surface-2 px-2 text-xs text-text outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
    >
      {options.map((n) => (
        <option key={n} value={n}>
          {n}件
        </option>
      ))}
    </select>
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
  // How many suggestions to request. Transient UI state (default 1), not
  // persisted; the server validates and clamps it anyway.
  const [count, setCount] = useState<number>(NEXT_ACTION_COUNT_DEFAULT);
  // Suggestions already shown for the current conversation state. Sent back
  // on regeneration so the API can tell the model to avoid repeating them.
  const [previousSuggestions, setPreviousSuggestions] = useState<string[]>([]);
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
    setState({ kind: "idle" });
    if (!isMd) setCollapsed(true);
  }, [taskId, sessionId, invalidateKey, isMd]);

  const generate = useCallback(async () => {
    if (!mountedRef.current) return;
    const generation = ++generationRef.current;
    setState({ kind: "loading" });
    try {
      const body: Record<string, unknown> = { sessionId, count };
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
  }, [taskId, sessionId, count, model, agent, previousSuggestions]);

  if (state.kind === "idle") {
    return (
      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={generate}
          aria-label="次の指示を提案"
        >
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          次の指示を提案
        </Button>
        <CountSelect value={count} onChange={setCount} />
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div
        className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-muted"
        aria-busy="true"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        <span role="status">提案を作成中…</span>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div
        className="mt-2 flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger-bg px-3 py-2 text-sm sm:flex-row sm:items-center"
        role="alert"
      >
        <span className="text-danger">{state.message}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={generate}
            aria-label="再試行"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            再試行
          </Button>
          <CountSelect value={count} onChange={setCount} />
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
    <div className="mt-2 rounded-xl border border-border bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={!isCollapsed}
            aria-controls={panelId}
            aria-label={isCollapsed ? "次の指示を展開" : "次の指示を折りたたむ"}
            onClick={() => setCollapsed((value) => !value)}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-lg text-left text-xs font-medium text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          >
            <ChevronDown
              aria-hidden="true"
              className={`h-3.5 w-3.5 shrink-0 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
            />
            <span className="min-w-0 flex-1 truncate">次の指示</span>
          </button>
        ) : (
          <p className="text-xs font-medium text-muted">次の指示</p>
        )}
        <CountSelect value={count} onChange={setCount} />
      </div>
      {!isCollapsed && (
        <div id={panelId} aria-live="polite" className="mt-1">
          <div
            role="list"
            aria-label="次の指示の提案一覧"
            className="flex flex-col gap-2"
          >
            {state.suggestions.map((suggestion, i) => (
              <div
                key={`${i}-${suggestion}`}
                role="listitem"
                className="rounded-lg border border-border bg-surface-2 px-2.5 py-2"
              >
                {multiple && (
                  <p className="text-[10px] font-medium text-faint">
                    提案 {i + 1}
                  </p>
                )}
                <p className="whitespace-pre-wrap text-sm text-text">
                  {suggestion}
                </p>
                <div className="mt-1.5">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => onApply(suggestion)}
                    aria-label={multiple ? `入力欄に入れる ${i + 1}` : "入力欄に入れる"}
                  >
                    <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />
                    入力欄に入れる
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={generate}
              aria-label="再生成"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              再生成
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
