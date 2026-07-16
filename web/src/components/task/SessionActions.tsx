"use client";

import { useState } from "react";
import { RotateCcw, RotateCw, Shrink } from "lucide-react";
import { Button } from "@/components/ui";
import { ocJson } from "@/lib/client";
import type { MessageWithParts } from "@/lib/types";

export async function revertMessage(
  directory: string,
  sessionId: string,
  messageID: string,
  partID?: string,
) {
  const body: Record<string, string> = { messageID };
  if (partID) body.partID = partID;
  await ocJson(`/session/${sessionId}/revert`, directory, {
    method: "POST",
    body,
  });
}

/**
 * Keep `anchorMessageId` visible; undo everything after it.
 *
 * OpenCode without partID snaps revert to the preceding user message and
 * would hide the anchor. Passing the *next* message + its first partID
 * avoids that snap-back.
 */
export async function revertAfterMessage(
  directory: string,
  sessionId: string,
  anchorMessageId: string,
  messages: MessageWithParts[],
) {
  const idx = messages.findIndex((m) => m.info.id === anchorMessageId);
  if (idx < 0) throw new Error("対象メッセージが見つかりません");
  const next = messages[idx + 1];
  if (!next) {
    throw new Error("このメッセージより後に巻き戻す内容がありません");
  }
  const partID = next.parts[0]?.id;
  await revertMessage(directory, sessionId, next.info.id, partID);
}

export async function unrevertSession(directory: string, sessionId: string) {
  await ocJson(`/session/${sessionId}/unrevert`, directory, {
    method: "POST",
    body: {},
  });
}

export function SessionActions({
  directory,
  sessionId,
  lastUserMessageId,
  onDone,
}: {
  directory: string;
  sessionId: string;
  /** Last user turn to undo entirely (prompt + reply). */
  lastUserMessageId?: string | null;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState<"compact" | "revert" | "unrevert" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const run = async (
    key: "compact" | "revert" | "unrevert",
    fn: () => Promise<"ok" | "cancelled">,
  ) => {
    setBusy(key);
    setError(null);
    try {
      const result = await fn();
      if (result === "ok") onDone?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "失敗しました";
      setError(msg);
      window.alert(`巻き戻し失敗: ${msg}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        title="コンテキスト圧縮 (compact)"
        busy={busy === "compact"}
        disabled={busy !== null}
        onClick={() =>
          void run("compact", async () => {
            await ocJson(`/api/session/${sessionId}/compact`, directory, {
              method: "POST",
              body: {},
            });
            return "ok";
          })
        }
      >
        <Shrink className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title={
          lastUserMessageId
            ? "直前のターンを取り消す（入力とその返答）"
            : "巻き戻すターンがありません"
        }
        busy={busy === "revert"}
        disabled={busy !== null || !lastUserMessageId}
        onClick={() =>
          void run("revert", async () => {
            if (!lastUserMessageId) throw new Error("messageID がありません");
            if (
              !window.confirm(
                "直前の入力とその返答を取り消しますか？\n（そのターンのメッセージは消えます）",
              )
            ) {
              return "cancelled";
            }
            // No partID: OpenCode snaps to this user message and hides it + after
            await revertMessage(directory, sessionId, lastUserMessageId);
            return "ok";
          })
        }
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="巻き戻しを取り消す (unrevert)"
        busy={busy === "unrevert"}
        disabled={busy !== null}
        onClick={() =>
          void run("unrevert", async () => {
            await unrevertSession(directory, sessionId);
            return "ok";
          })
        }
      >
        <RotateCw className="h-4 w-4" />
      </Button>
      {error && (
        <span
          className="max-w-[8rem] truncate text-[10px] text-danger"
          title={error}
        >
          {error}
        </span>
      )}
    </div>
  );
}

/** Keep this message; undo everything after it. */
export function MessageRevertButton({
  directory,
  sessionId,
  messageId,
  messages,
  disabled,
  onDone,
}: {
  directory: string;
  sessionId: string;
  messageId: string;
  messages: MessageWithParts[];
  disabled?: boolean;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const idx = messages.findIndex((m) => m.info.id === messageId);
  const hasAfter = idx >= 0 && idx < messages.length - 1;

  return (
    <button
      type="button"
      disabled={disabled || busy || !hasAfter}
      title={
        hasAfter
          ? "このメッセージは残し、これより後を巻き戻す"
          : "このメッセージより後がありません"
      }
      onClick={() => {
        void (async () => {
          if (
            !window.confirm(
              "このメッセージは残し、これより後の会話と変更を巻き戻しますか？",
            )
          ) {
            return;
          }
          setBusy(true);
          try {
            await revertAfterMessage(
              directory,
              sessionId,
              messageId,
              messages,
            );
            onDone?.();
          } catch (err) {
            window.alert(
              err instanceof Error ? err.message : "巻き戻しに失敗しました",
            );
          } finally {
            setBusy(false);
          }
        })();
      }}
      className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-faint hover:bg-surface-2 hover:text-muted disabled:opacity-40"
    >
      <RotateCcw className={busy ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
      これより後を巻き戻し
    </button>
  );
}
