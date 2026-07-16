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

export async function unrevertSession(directory: string, sessionId: string) {
  await ocJson(`/session/${sessionId}/unrevert`, directory, {
    method: "POST",
    body: {},
  });
}

/** Collect plain text from a user message for the composer. */
export function messagePlainText(msg: MessageWithParts | undefined): string {
  if (!msg) return "";
  return msg.parts
    .filter((p) => p.type === "text" && p.text?.trim())
    .map((p) => p.text!.trim())
    .join("\n\n");
}

/**
 * Undo from this user message onward (message is hidden), return its text
 * so the caller can put it in the composer.
 */
export async function revertUserMessageToComposer(
  directory: string,
  sessionId: string,
  messageId: string,
  messages: MessageWithParts[],
): Promise<string> {
  const msg = messages.find((m) => m.info.id === messageId);
  if (!msg) throw new Error("対象メッセージが見つかりません");
  if (msg.info.role !== "user") {
    throw new Error("ユーザーメッセージのみ入力欄に戻せます");
  }
  const text = messagePlainText(msg);
  if (!text) throw new Error("戻すテキストがありません");
  // Inclusive revert: hide this message and everything after
  await revertMessage(directory, sessionId, messageId);
  return text;
}

export function SessionActions({
  directory,
  sessionId,
  lastUserMessageId,
  messages,
  onRestoreText,
  onDone,
}: {
  directory: string;
  sessionId: string;
  lastUserMessageId?: string | null;
  messages: MessageWithParts[];
  onRestoreText?: (text: string) => void;
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
            ? "直前の入力を下の欄に戻して巻き戻す"
            : "巻き戻すターンがありません"
        }
        busy={busy === "revert"}
        disabled={busy !== null || !lastUserMessageId}
        onClick={() =>
          void run("revert", async () => {
            if (!lastUserMessageId) throw new Error("messageID がありません");
            if (
              !window.confirm(
                "直前の入力を下の入力欄に戻し、その返答以降を巻き戻しますか？",
              )
            ) {
              return "cancelled";
            }
            const text = await revertUserMessageToComposer(
              directory,
              sessionId,
              lastUserMessageId,
              messages,
            );
            onRestoreText?.(text);
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

/** Put this user comment into the composer and revert from here onward. */
export function MessageRevertButton({
  directory,
  sessionId,
  messageId,
  messages,
  disabled,
  onRestoreText,
  onDone,
}: {
  directory: string;
  sessionId: string;
  messageId: string;
  messages: MessageWithParts[];
  disabled?: boolean;
  onRestoreText?: (text: string) => void;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={disabled || busy}
      title="このコメントを入力欄に戻して巻き戻す"
      onClick={() => {
        void (async () => {
          if (
            !window.confirm(
              "このコメントを下の入力欄に戻し、ここ以降を巻き戻しますか？",
            )
          ) {
            return;
          }
          setBusy(true);
          try {
            const text = await revertUserMessageToComposer(
              directory,
              sessionId,
              messageId,
              messages,
            );
            onRestoreText?.(text);
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
      入力欄に戻す
    </button>
  );
}
