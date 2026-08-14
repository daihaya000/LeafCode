"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, RefreshCw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui";
import { sendJson } from "@/lib/client";
import {
  NEXT_ACTION_PREVIOUS_MAX_COUNT,
  parseSuggestions,
} from "@/lib/next-action-text";

/** How many proposals are requested per generation (API clamps to 1–3). */
const NEXT_TASK_COUNT = 3;

/**
 * Generating from repository state runs sequential prompts server-side
 * (one per suggestion, 60s each), so the default 30s client timeout would
 * abort a request the server is still legitimately working on.
 */
const NEXT_TASK_TIMEOUT_MS = 180_000;

type NextTaskState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; suggestions: string[] }
  | { kind: "error" };

export type NextTaskSuggestProps = {
  /** Selected project. Generation is disabled while empty. */
  projectId: string;
  /** Currently selected model key (providerID::modelID) in the composer. */
  model?: string;
  /** Currently selected agent in the composer. */
  agent?: string;
  /** Disables generation (e.g. while submitting or the engine is down). */
  disabled?: boolean;
  /** Called when the user accepts a proposal. Must NOT send the prompt. */
  onApply: (suggestion: string) => void;
};

/**
 * Home "次のタスクを提案" UI.
 *
 * Home has no session, so proposals come from the selected project's
 * repository state via POST /api/projects/[id]/next-task. Results are only
 * ever written into the composer by explicit user action — this component
 * never starts a task by itself.
 *
 * On regeneration every proposal shown so far is sent back as an exclusion
 * so the model produces different ones.
 */
export function NextTaskSuggest({
  projectId,
  model,
  agent,
  disabled = false,
  onApply,
}: NextTaskSuggestProps) {
  const [state, setState] = useState<NextTaskState>({ kind: "idle" });
  // Proposals already shown for the current project. Sent back on
  // regeneration so the API can tell the model to avoid repeating them.
  const [previousSuggestions, setPreviousSuggestions] = useState<string[]>([]);
  const [appliedIndex, setAppliedIndex] = useState<number | null>(null);
  const projectRef = useRef(projectId);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Invalidate any in-flight generation so its late resolve is ignored.
      generationRef.current += 1;
    };
  }, []);

  // Proposals belong to one repository. Switching projects invalidates both
  // the visible result and the exclusion list.
  useEffect(() => {
    if (projectRef.current === projectId) return;
    projectRef.current = projectId;
    generationRef.current += 1;
    setPreviousSuggestions([]);
    setAppliedIndex(null);
    setState({ kind: "idle" });
  }, [projectId]);

  const generate = useCallback(async () => {
    if (!mountedRef.current || !projectId) return;
    const generation = ++generationRef.current;
    setAppliedIndex(null);
    setState({ kind: "loading" });
    try {
      const body: Record<string, unknown> = { count: NEXT_TASK_COUNT };
      if (model) {
        const [providerID, modelID] = model.split("::");
        if (providerID && modelID) body.model = { providerID, modelID };
      }
      if (agent) body.agent = agent;
      if (previousSuggestions.length > 0) {
        body.previousSuggestions = previousSuggestions;
      }
      const res = await sendJson<{
        suggestion?: unknown;
        suggestions?: unknown;
      }>(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/next-task`,
        body,
        undefined,
        { timeoutMs: NEXT_TASK_TIMEOUT_MS },
      );
      const suggestions = parseSuggestions(res);
      if (suggestions.length === 0) throw new Error("empty suggestions");
      if (!mountedRef.current || generation !== generationRef.current) return;
      // Remember everything shown so far so the next regeneration excludes
      // all of them (capped to keep the prompt bounded).
      setPreviousSuggestions((prev) => {
        const next = [...prev];
        for (const s of suggestions) if (!next.includes(s)) next.push(s);
        return next.length > NEXT_ACTION_PREVIOUS_MAX_COUNT
          ? next.slice(next.length - NEXT_ACTION_PREVIOUS_MAX_COUNT)
          : next;
      });
      setState({ kind: "success", suggestions });
    } catch (err) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      console.warn("[NextTaskSuggest] generate failed", err);
      // Never surface raw server messages.
      setState({ kind: "error" });
    }
  }, [projectId, model, agent, previousSuggestions]);

  const dismiss = useCallback(() => {
    generationRef.current += 1;
    setAppliedIndex(null);
    setState({ kind: "idle" });
  }, []);

  const busy = state.kind === "loading";
  const canGenerate = !disabled && !busy && Boolean(projectId);

  return (
    <section
      className="mx-auto mt-3 max-w-5xl"
      aria-label="次のタスクを提案"
    >
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          busy={busy}
          disabled={!canGenerate}
          onClick={() => void generate()}
          title={
            projectId
              ? "リポジトリの状態から次に着手すべきタスクを提案します"
              : "プロジェクトを選択してください"
          }
        >
          {!busy && <Sparkles className="h-3.5 w-3.5" />}
          {busy
            ? "提案を生成中…"
            : state.kind === "success"
              ? "別の提案を生成"
              : "次のタスクを提案"}
        </Button>
        {state.kind === "success" && !busy && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="提案を閉じる"
            onClick={dismiss}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {state.kind === "error" && (
        <div className="mt-2 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2">
          <p role="alert" className="text-sm text-danger">
            提案の生成に失敗しました。
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1"
            disabled={!canGenerate}
            onClick={() => void generate()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            再試行
          </Button>
        </div>
      )}

      {state.kind === "success" && (
        <ul className="mt-2 flex flex-col gap-2">
          {state.suggestions.map((suggestion, index) => (
            <li key={`${index}-${suggestion}`}>
              <button
                type="button"
                onClick={() => {
                  setAppliedIndex(index);
                  onApply(suggestion);
                }}
                disabled={disabled}
                title="この提案をコンポーザーに反映"
                className="flex w-full items-start gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-left text-sm text-text transition-colors hover:border-border-strong hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ArrowDownToLine
                  aria-hidden="true"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted"
                />
                <span className="min-w-0 flex-1 break-words">{suggestion}</span>
                {appliedIndex === index && (
                  <span className="shrink-0 text-[11px] leading-5 text-muted">
                    反映済み
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
