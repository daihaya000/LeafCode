import { useState } from "react";
import {
  Check,
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
  if (p.status === "completed" || p.status === "verified_completed")
    return <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />;
  if (p.status === "blocked")
    return <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />;
  return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-working" />;
}

const DEFAULT_VISIBLE = 3;
const MAX_HISTORY = 5;

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
  const [editingMaxTurns, setEditingMaxTurns] = useState<number | null>(null);

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
    if (
      !window.confirm(
        "Goalループを停止しますか？セッションは中断され、進行中の作業は失われます。",
      )
    )
      return;
    onAction("stop");
  };

  // newest first
  const reversed = [...loop.progress].reverse();
  const visibleCount = expanded ? MAX_HISTORY : DEFAULT_VISIBLE;
  const visible = reversed.slice(0, visibleCount);
  const hiddenCount = Math.max(0, reversed.length - DEFAULT_VISIBLE);
  const showToggle = reversed.length > DEFAULT_VISIBLE;

  const badgeText = `${STATUS_LABEL[loop.status]} ${loop.turnCount}/${loop.maxTurns}`;
  // `turnCount` counts goal turns only; completion-verification turns are not
  // charged to the budget, so say so rather than letting the ratio look stuck.
  const badgeAria = `Goalループ状態: ${STATUS_LABEL[loop.status]}、Goalターン ${loop.turnCount} / ${loop.maxTurns}（完了検証ターンは含みません）`;
  const pauseHint =
    loop.status === "paused" && loop.pauseReason !== ""
      ? PAUSE_REASON_HINT[loop.pauseReason]
      : null;

  const commitMaxTurns = () => {
    if (editingMaxTurns == null) return;
    const clamped = Math.min(100, Math.max(1, Math.trunc(editingMaxTurns)));
    if (clamped !== loop.maxTurns) onUpdateMaxTurns?.(clamped);
    setEditingMaxTurns(null);
  };

  return (
    <div
      role="region"
      aria-label="Goalループ"
      data-live={live ? "true" : undefined}
      className={cx(
        "rounded-xl border border-border bg-surface p-3 text-sm",
        live &&
          // 追従時は背景を不透明のまま、履歴が伸びても画面を占有しないよう高さを制限する
          "sticky top-0 z-10 max-h-[45dvh] overflow-y-auto shadow-md",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-medium text-text">
            <ListTodo className="h-4 w-4 text-primary" />
            Goalループ
            <span
              className={cx(
                "rounded-full px-2 py-0.5 text-[11px]",
                statusBadgeClass(loop.status),
              )}
              aria-label={badgeAria}
            >
              {badgeText}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted">{loop.goal}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {canPause && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              aria-label="Goalループを一時停止"
              onClick={() => onAction("pause")}
            >
              <Pause className="h-3.5 w-3.5" />
              一時停止
            </Button>
          )}
          {canResume && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              aria-label="Goalループを再開"
              onClick={() => onAction("resume")}
            >
              <Play className="h-3.5 w-3.5" />
              再開
            </Button>
          )}
          {canStop && (
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              aria-label="Goalループを停止"
              onClick={handleStop}
            >
              <Square className="h-3.5 w-3.5" />
              停止
            </Button>
          )}
        </div>
      </div>

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
              onClick={() => setEditingMaxTurns(loop.maxTurns)}
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
                onChange={(e) =>
                  setEditingMaxTurns(
                    Math.min(100, Math.max(1, Number(e.target.value) || 1)),
                  )
                }
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

      {visible.length > 0 && (
        <ol role="list" className="mt-2 space-y-1.5">
          {visible.map((p, i) => (
            <li
              key={`${p.time}-${i}`}
              role="listitem"
              className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted"
            >
              <div className="flex items-start gap-2">
                {progressIcon(p)}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-text">{p.summary}</span>
                    <span className="shrink-0 text-[10px] text-faint">
                      {formatMessageTime(p.time)}
                    </span>
                  </div>
                  {p.next && <div className="mt-1">次: {p.next}</div>}
                  {p.evidence && <div className="mt-1">証跡: {p.evidence}</div>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {showToggle && (
        <button
          type="button"
          className="mt-2 text-xs text-primary hover:underline"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? "履歴を折りたたむ" : `履歴を表示(残り${hiddenCount}件)`}
        </button>
      )}

      {loop.error && (
        <div
          role="alert"
          className="mt-2 rounded-lg bg-warning-bg px-3 py-2 text-xs text-warning"
        >
          {loop.error}
          {pauseHint && <p className="mt-1 text-muted">{pauseHint}</p>}
        </div>
      )}
      {!loop.error && pauseHint && (
        <p className="mt-2 text-xs text-muted">{pauseHint}</p>
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
  );
}
