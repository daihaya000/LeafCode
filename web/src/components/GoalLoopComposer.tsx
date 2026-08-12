"use client";

import { useEffect, useState } from "react";
import { ListTodo } from "lucide-react";
import { cx } from "@/components/ui";

/**
 * Composer-level Goal loop UI shared by the top page (HomeView) and the
 * session view (TaskView).
 *
 * The toggle is a compact pill that lives in the composer toolbar so it costs
 * no vertical space while OFF; the acceptance / maxTurns inputs only appear
 * once the toggle is ON. The composer textarea itself carries the goal text,
 * which is why there is no dedicated "goal" field here.
 */

export const GOAL_LOOP_TOGGLE_LABEL = "ループで継続実行";
export const GOAL_LOOP_FORCE_FULL_RUN_LABEL = "完走モード";
export const GOAL_LOOP_FORCE_FULL_RUN_HINT =
  "完了宣言を使わず、指定の最大ターン数まで必ず実行します";

export function GoalLoopToggle({
  enabled,
  disabled,
  onToggle,
  className,
}: {
  enabled: boolean;
  disabled?: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={GOAL_LOOP_TOGGLE_LABEL}
      title={GOAL_LOOP_TOGGLE_LABEL}
      disabled={disabled}
      onClick={onToggle}
      className={cx(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors disabled:opacity-40",
        enabled
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-bg text-muted hover:bg-surface-2 hover:text-text",
        className,
      )}
    >
      <ListTodo className="h-3.5 w-3.5" aria-hidden="true" />
      ループ
    </button>
  );
}

export function GoalLoopOptions({
  acceptance,
  maxTurns,
  forceFullRun = false,
  disabled,
  onAcceptanceChange,
  onMaxTurnsChange,
  onForceFullRunChange,
}: {
  acceptance: string;
  maxTurns: number;
  /** 完走モード。既定 OFF。 */
  forceFullRun?: boolean;
  disabled?: boolean;
  onAcceptanceChange: (value: string) => void;
  onMaxTurnsChange: (value: number) => void;
  onForceFullRunChange?: (value: boolean) => void;
}) {
  // Keep the number field as a string draft so clearing it to type a new
  // value does not snap back to 1 on every keystroke (BU-3). The clamped
  // value is reported on blur / Enter, mirroring GoalLoopPanel's editor.
  const [maxTurnsDraft, setMaxTurnsDraft] = useState(String(maxTurns));
  useEffect(() => {
    setMaxTurnsDraft(String(maxTurns));
  }, [maxTurns]);

  const commitMaxTurns = () => {
    const clamped = Math.min(
      100,
      Math.max(1, Math.trunc(Number(maxTurnsDraft) || 1)),
    );
    if (clamped !== maxTurns) onMaxTurnsChange(clamped);
    setMaxTurnsDraft(String(clamped));
  };

  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-start gap-2">
        <textarea
          value={acceptance}
          disabled={disabled}
          onChange={(e) => onAcceptanceChange(e.target.value)}
          rows={2}
          placeholder="承認条件（任意・1行に1つ）"
          aria-label="承認条件"
          className="min-w-0 flex-1 resize-none rounded-lg border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
          最大ターン
          <input
            type="number"
            min={1}
            max={100}
            value={maxTurnsDraft}
            disabled={disabled}
            aria-label="最大ターン数"
            onChange={(e) => setMaxTurnsDraft(e.target.value)}
            onBlur={commitMaxTurns}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitMaxTurns();
              }
            }}
            className="h-8 w-16 rounded-lg border border-border bg-bg px-2 text-sm text-text outline-none focus:border-primary"
          />
        </label>
      </div>
      {onForceFullRunChange ? (
        <label
          className="flex cursor-pointer items-center gap-2 text-xs text-muted"
          title={GOAL_LOOP_FORCE_FULL_RUN_HINT}
        >
          <input
            type="checkbox"
            checked={forceFullRun}
            disabled={disabled}
            aria-label={GOAL_LOOP_FORCE_FULL_RUN_LABEL}
            onChange={(e) => onForceFullRunChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-primary"
          />
          <span>
            {GOAL_LOOP_FORCE_FULL_RUN_LABEL}
            <span className="ml-1 text-faint">（完了宣言なし・指定ターン数を必ず実行）</span>
          </span>
        </label>
      ) : null}
    </div>
  );
}
