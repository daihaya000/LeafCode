"use client";

import { useState } from "react";
import { RotateCcw, RotateCw, Shrink } from "lucide-react";
import { Button } from "@/components/ui";
import { ocJson } from "@/lib/client";

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

export function SessionActions({
  directory,
  sessionId,
  lastMessageId,
  onDone,
}: {
  directory: string;
  sessionId: string;
  /** Message to revert from (OpenCode requires messageID). */
  lastMessageId?: string | null;
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
      setError(err instanceof Error ? err.message : "失敗しました");
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
          lastMessageId
            ? "直前のターンを巻き戻し"
            : "巻き戻すメッセージがありません"
        }
        busy={busy === "revert"}
        disabled={busy !== null || !lastMessageId}
        onClick={() =>
          void run("revert", async () => {
            if (!lastMessageId) throw new Error("messageID がありません");
            if (
              !window.confirm(
                "このメッセージ以降の会話と変更を巻き戻しますか？",
              )
            ) {
              return "cancelled";
            }
            await revertMessage(directory, sessionId, lastMessageId);
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

/** Inline control on a timeline message. */
export function MessageRevertButton({
  directory,
  sessionId,
  messageId,
  disabled,
  onDone,
}: {
  directory: string;
  sessionId: string;
  messageId: string;
  disabled?: boolean;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled || busy}
      title="ここから巻き戻す"
      onClick={() => {
        void (async () => {
          if (!window.confirm("このメッセージ以降を巻き戻しますか？")) return;
          setBusy(true);
          try {
            await revertMessage(directory, sessionId, messageId);
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
      巻き戻し
    </button>
  );
}
