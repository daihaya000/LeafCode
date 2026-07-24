"use client";

import { useCallback, useState } from "react";
import { Sparkles, Loader2, RefreshCw, ArrowDownToLine } from "lucide-react";
import { Button } from "@/components/ui";
import { sendJson } from "@/lib/client";

type NextActionState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; suggestion: string }
  | { kind: "error"; message: string };

export type NextActionProps = {
  taskId: string;
  sessionId: string;
  /** Currently selected model key (providerID::modelID) in the composer. */
  model?: string;
  /** Currently selected agent in the composer. */
  agent?: string;
  /** Called when the user accepts the suggestion. Must NOT send the prompt. */
  onApply: (suggestion: string) => void;
  /** Optional invalidation key — when it changes, reset to idle. */
  invalidateKey?: string | number;
};

/**
 * NextAction UI: generates a single next-action suggestion from the current
 * session's conversation and offers it to the user for manual application
 * to the composer. Never auto-sends.
 */
export function NextAction({
  taskId,
  sessionId,
  model,
  agent,
  onApply,
  invalidateKey,
}: NextActionProps) {
  const [state, setState] = useState<NextActionState>({ kind: "idle" });
  const [lastInvalidateKey, setLastInvalidateKey] = useState(invalidateKey);

  // Reset to idle when the invalidation key changes (conversation updated,
  // revert, or task switch).
  if (invalidateKey !== lastInvalidateKey) {
    setLastInvalidateKey(invalidateKey);
    if (state.kind !== "idle" && state.kind !== "loading") {
      setState({ kind: "idle" });
    }
  }

  const generate = useCallback(async () => {
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
      const res = await sendJson<{ suggestion: string }>(
        "POST",
        `/api/tasks/${taskId}/next-action`,
        body,
      );
      setState({ kind: "success", suggestion: res.suggestion });
    } catch (err) {
      console.warn("[NextAction] generate failed", err);
      setState({
        kind: "error",
        // Never surface raw server messages — always show the fixed
        // Japanese string per spec 5.2.
        message: "提案の生成に失敗しました。",
      });
    }
  }, [taskId, sessionId, model, agent]);

  if (state.kind === "idle") {
    return (
      <div className="mt-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={generate}
          aria-label="次の指示を提案"
        >
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          次の指示を提案
        </Button>
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
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={generate}
            aria-label="再試行"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            再試行
          </Button>
        </div>
      </div>
    );
  }

  // success
  return (
    <div className="mt-2 rounded-xl border border-border bg-surface px-3 py-2">
      <p className="text-xs font-medium text-muted">次の指示</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-text">
        {state.suggestion}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => onApply(state.suggestion)}
          aria-label="入力欄に入れる"
        >
          <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />
          入力欄に入れる
        </Button>
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
  );
}
