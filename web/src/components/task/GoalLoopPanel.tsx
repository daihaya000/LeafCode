import { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  ListTodo,
  Loader2,
  Pause,
  Play,
  Square,
} from "lucide-react";
import { Button, cx, formatMessageTime } from "@/components/ui";
import type { GoalLoopDto, GoalLoopProgress } from "@/lib/goal-loop";

const STATUS_LABEL: Record<GoalLoopDto["status"], string> = {
  queued: "実行中",
  running: "実行中",
  paused: "一時停止",
  verifying_completed: "完了検証中",
  completed: "完了",
  blocked: "ブロック",
  stopped: "停止",
};

/**
 * Why the loop is paused, stated as what resuming will do. `error` alone was
 * ambiguous — a delivery-unknown pause and a manual-send pause read the same to
 * the user but resume very differently.
 */
const PAUSE_REASON_HINT: Record<Exclude<GoalLoopDto["pauseReason"], "">, string> = {
  user: "再開すると次のターンを送信します。",
  manual_send: "手動送信を検出しました。再開すると次のターンを送信します。",
  turn_limit: "最大ターン数に達しました。上限を増やすと再開できます。",
  unreadable_result:
    "応答から結果を読み取れませんでした。再開すると同じターンを送り直します。",
  turn_timeout: "応答が確認できませんでした。再開すると同じターンを送り直します。",
  unknown_delivery:
    "送信の到達を確認できませんでした。再開時に送信済みかを判定し、重複送信は行いません。",
  transcript_unreadable:
    "会話履歴を読み取れませんでした。再開時に読み直します。",
  boundary_lost: "会話履歴の基準点を見失いました。再開時に基準点を取り直します。",
  verification_rejected:
    "完了報告が検証で否認されました。再開すると却下回数をリセットして作業を続けます。",
  scheduler_error:
    "OpenCode の呼び出しに失敗しました。再開すると同じ位置から再試行します。",
};

/** badge class for each status */
function statusBadgeClass(status: GoalLoopDto["status"]): string {
  switch (status) {
    case "queued":
    case "running":
      return "bg-working/15 text-working";
    case "verifying_completed":
      return "bg-primary/15 text-primary";
    case "paused":
      return "bg-surface-2 text-muted";
    case "completed":
      return "bg-success/15 text-success";
    case "blocked":
      return "bg-warning-bg text-warning";
    case "stopped":
      return "bg-surface-2 text-muted";
    default:
      return "bg-surface-2 text-muted";
  }
}

function progressIcon(p: GoalLoopProgress) {
  if (
    p.status === "completed" ||
    p.status === "verifying_completed" ||
    p.status === "verified_completed"
  )
    return (
      <Check
        data-testid="goal-loop-progress-check"
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success"
      />
    );
  if (p.status === "blocked")
    return <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />;
  return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-working" />;
}

export function GoalLoopPanel({
  loop,
  busy,
  onAction,
  onUpdateMaxTurns,
}: {
  loop: GoalLoopDto | null;
  busy: boolean;
  onAction: (action: "pause" | "resume" | "stop") => void;
  onUpdateMaxTurns?: (maxTurns: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  // Unique ids per mounted panel so split view never duplicates DOM ids (BU-9).
  const detailId = useId();
  const stopConfirmId = useId();
  // Keep the draft as text. Clamping on every keystroke made it impossible to
  // clear a value such as `1` before typing a multi-digit replacement (`20`).
  const [editingMaxTurns, setEditingMaxTurns] = useState<string | null>(null);
  const stopDialogRef = useRef<HTMLDivElement | null>(null);
  const stopTriggerRef = useRef<HTMLElement | null>(null);

  const terminal =
    loop?.status === "completed" || loop?.status === "blocked" || loop?.status === "stopped";

  useEffect(() => {
    if (terminal) setExpanded(false);
  }, [terminal]);

  useEffect(() => {
    if (!stopConfirmOpen) {
      if (
        stopTriggerRef.current?.isConnected &&
        (document.activeElement === document.body || document.activeElement === null)
      ) {
        stopTriggerRef.current.focus();
      }
      stopTriggerRef.current = null;
      return;
    }
    stopDialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setStopConfirmOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [stopConfirmOpen]);

  if (!loop) return null;

  const running = loop.status === "queued" || loop.status === "running";
  const canPause = running || loop.status === "verifying_completed";
  // ループが生きている間（実行中・完了検証中・一時停止）は、下までスクロールしても
  // 状態確認と一時停止/停止操作ができるよう上部に追従させる。
  // 終了状態では開始フォームが下に出るため通常フローに戻す。
  const live =
    running || loop.status === "verifying_completed" || loop.status === "paused";
  const canStop =
    loop.status !== "completed" &&
    loop.status !== "blocked" &&
    loop.status !== "stopped";
  const canResume = loop.status === "paused";
  const canEditMaxTurns = loop.status === "paused" && Boolean(onUpdateMaxTurns);

  const handleStop = () => {
    if (stopConfirmOpen) return;
    stopTriggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setStopConfirmOpen(true);
  };

  // A goal loop can accumulate many completed turns. Keep the panel compact by
  // showing only its current (most recent) task; the complete history remains
  // available in the conversation transcript.
  const currentProgress = loop.progress.at(-1);

  const badgeText = `${STATUS_LABEL[loop.status]} ${loop.turnCount}/${loop.maxTurns}`;
  // `turnCount` counts goal turns only; completion-verification turns are not
  // charged to the budget, so say so rather than letting the ratio look stuck.
  // 完走モードでは検証ターン自体が存在しない。
  const badgeAria = loop.forceFullRun
    ? `ループ状態: ${STATUS_LABEL[loop.status]}、完走モード、Goalターン ${loop.turnCount} / ${loop.maxTurns}`
    : `ループ状態: ${STATUS_LABEL[loop.status]}、Goalターン ${loop.turnCount} / ${loop.maxTurns}（完了検証ターンは含みません）`;
  const pauseHint =
    loop.status === "paused" && loop.pauseReason !== ""
      ? PAUSE_REASON_HINT[loop.pauseReason]
      : null;
  const terminalSummary =
    loop.status === "completed"
      ? `完了: ${loop.summary || currentProgress?.summary || "Goalを達成しました。"}`
      : loop.status === "blocked"
        ? `ブロック: ${loop.blockedReason || currentProgress?.summary || "対応が必要です。"}`
        : loop.status === "stopped"
          ? "停止しました。"
          : null;

  const commitMaxTurns = () => {
    if (editingMaxTurns == null) return;
    const clamped = Math.min(100, Math.max(1, Math.trunc(Number(editingMaxTurns) || 1)));
    if (clamped !== loop.maxTurns) onUpdateMaxTurns?.(clamped);
    setEditingMaxTurns(null);
  };

  return (
    <div
      role="region"
      aria-label="ループ"
      data-live={live ? "true" : undefined}
      className={cx(
        "rounded-xl border border-border bg-surface p-3 text-sm",
        live &&
          "sticky top-0 z-10 shadow-md",
        expanded && "max-h-[45dvh] overflow-y-auto",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex shrink-0 items-center gap-2 font-medium text-text">
            <ListTodo className="h-4 w-4 text-primary" />
            ループ
            <span
              className={cx(
                "rounded-full px-2 py-0.5 text-[11px]",
                statusBadgeClass(loop.status),
              )}
              aria-label={badgeAria}
            >
              {badgeText}
            </span>
            {loop.forceFullRun ? (
              <span
                className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted"
                title="完了宣言を使わず、指定ターン数まで必ず実行します"
              >
                完走
              </span>
            ) : null}
          </div>
          <p className="min-w-0 flex-1 truncate text-xs text-muted" title={loop.goal}>
            {loop.goal}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label={expanded ? "ループの詳細を折りたたむ" : "ループの詳細を展開"}
            aria-controls={detailId}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDown className={cx("h-4 w-4 transition-transform", !expanded && "-rotate-90")} />
          </button>
          {canPause && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || loop.pauseRequested}
              aria-label="ループを一時停止"
              onClick={() => onAction("pause")}
            >
              <Pause className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">一時停止</span>
            </Button>
          )}
          {canResume && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              aria-label="ループを再開"
              title="ループを再開"
              onClick={() => onAction("resume")}
            >
              <Play className="h-3.5 w-3.5" />
              <span>再開</span>
            </Button>
          )}
          {canStop && (
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              aria-label="ループを停止"
              onClick={handleStop}
            >
              <Square className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">停止</span>
            </Button>
          )}
        </div>
      </div>

      {stopConfirmOpen && canStop && (
        <div
          ref={stopDialogRef}
          id={stopConfirmId}
          role="dialog"
          aria-label="ループ停止の確認"
          aria-describedby={`${stopConfirmId}-description`}
          className="mt-3 rounded-lg border border-danger/30 bg-danger-bg px-3 py-3 text-sm text-danger"
        >
          <p id={`${stopConfirmId}-description`}>
            ループを停止しますか？セッションは中断され、進行中の作業は失われます。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setStopConfirmOpen(false);
                onAction("stop");
              }}
            >
              停止する
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setStopConfirmOpen(false)}
            >
              キャンセル
            </Button>
          </div>
        </div>
      )}

      {loop.acceptance?.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
          <span className="text-muted">承認条件:</span>
          {loop.acceptance.map((criterion, index) => (
            <span
              key={index}
              className="inline-flex items-center rounded-md bg-surface-2 px-2 py-0.5 text-text"
              title={criterion}
            >
              {criterion}
            </span>
          ))}
        </div>
      )}
      {pauseHint && <p className="mt-2 truncate text-xs text-muted">{pauseHint}</p>}
      {loop.pauseRequested && (
        <p className="mt-2 text-xs text-muted">このターンの完了後に一時停止します。</p>
      )}
      {terminalSummary && (
        <p
          className={cx(
            "mt-2 truncate text-xs",
            loop.status === "completed"
              ? "text-success"
              : loop.status === "blocked"
                ? "text-warning"
                : "text-muted",
          )}
          title={terminalSummary}
        >
          {terminalSummary}
        </p>
      )}

      {expanded && (
        <div id={detailId} className="mt-3 border-t border-border pt-3" aria-live="polite">
      {canEditMaxTurns && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          <label htmlFor="goal-loop-maxturns" className="shrink-0">
            最大ターン
          </label>
          {editingMaxTurns == null ? (
            <button
              type="button"
              id="goal-loop-maxturns"
              className="h-7 w-20 rounded-lg border border-border bg-bg px-2 text-sm text-text outline-none focus:border-primary"
              onClick={() => setEditingMaxTurns(String(loop.maxTurns))}
              aria-label="最大ターン数を編集"
            >
              {loop.maxTurns}
            </button>
          ) : (
            <>
              <input
                id="goal-loop-maxturns"
                type="number"
                min={1}
                max={100}
                autoFocus
                value={editingMaxTurns}
                aria-label="最大ターン数"
                onChange={(e) => setEditingMaxTurns(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitMaxTurns();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingMaxTurns(null);
                  }
                }}
                className="h-7 w-20 rounded-lg border border-border bg-bg px-2 text-sm text-text outline-none focus:border-primary"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={commitMaxTurns}
                aria-label="最大ターン数を保存"
              >
                保存
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingMaxTurns(null)}
                aria-label="最大ターン数編集をキャンセル"
              >
                キャンセル
              </Button>
            </>
          )}
        </div>
      )}

      {currentProgress && (
        <ol role="list" className="mt-2 space-y-1.5">
          <li
            role="listitem"
            className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted"
          >
            <div className="flex items-start gap-2">
              {progressIcon(currentProgress)}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text">{currentProgress.summary}</span>
                  <span className="shrink-0 text-[10px] text-faint">
                    {formatMessageTime(currentProgress.time)}
                  </span>
                </div>
                {currentProgress.next && <div className="mt-1">次: {currentProgress.next}</div>}
                {currentProgress.evidence && (
                  <div className="mt-1">証跡: {currentProgress.evidence}</div>
                )}
              </div>
            </div>
          </li>
        </ol>
      )}

      {loop.error && (
        <div
          role="alert"
          className="mt-2 rounded-lg bg-warning-bg px-3 py-2 text-xs text-warning"
        >
          {loop.error}
        </div>
      )}
      {loop.blockedReason && (
        <div
          role="alert"
          className="mt-2 rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger"
        >
          {loop.blockedReason}
        </div>
      )}
        </div>
      )}
    </div>
  );
}
