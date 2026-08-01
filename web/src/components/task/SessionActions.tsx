"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Shrink } from "lucide-react";
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

export type SessionActionKey = "compact" | "revert" | "unrevert";

export function useSessionActions({
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
  const [busy, setBusy] = useState<SessionActionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef<SessionActionKey | null>(null);
  const mountedRef = useRef(false);
  const actionGenerationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    actionGenerationRef.current += 1;
    busyRef.current = null;
    setError(null);
    setBusy(null);
    return () => {
      mountedRef.current = false;
      actionGenerationRef.current += 1;
    };
  }, [directory, sessionId]);

  const run = useCallback(
    async (key: SessionActionKey, fn: () => Promise<"ok" | "cancelled">) => {
      if (busyRef.current !== null) return;
      const generation = actionGenerationRef.current;
      busyRef.current = key;
      setBusy(key);
      setError(null);
      try {
        const result = await fn();
        if (
          result === "ok" &&
          mountedRef.current &&
          generation === actionGenerationRef.current
        ) {
          onDone?.();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "失敗しました";
        if (mountedRef.current && generation === actionGenerationRef.current) {
          setError(msg);
        }
      } finally {
        busyRef.current = null;
        if (mountedRef.current && generation === actionGenerationRef.current) {
          setBusy(null);
        }
      }
    },
    [onDone],
  );

  const compact = useCallback(() => {
    void run("compact", async () => {
      await ocJson(`/api/session/${sessionId}/compact`, directory, {
        method: "POST",
        body: {},
      });
      return "ok" as const;
    });
  }, [run, directory, sessionId]);

  const revert = useCallback(() => {
    void run("revert", async () => {
      if (!lastUserMessageId) throw new Error("messageID がありません");
      if (
        !window.confirm(
          "直前の入力を下の入力欄に戻し、その返答以降を巻き戻しますか？",
        )
      ) {
        return "cancelled" as const;
      }
      const text = await revertUserMessageToComposer(
        directory,
        sessionId,
        lastUserMessageId,
        messages,
      );
      onRestoreText?.(text);
      return "ok" as const;
    });
  }, [run, directory, sessionId, lastUserMessageId, messages, onRestoreText]);

  const unrevert = useCallback(() => {
    void run("unrevert", async () => {
      await unrevertSession(directory, sessionId);
      return "ok" as const;
    });
  }, [run, directory, sessionId]);

  return { busy, error, compact, revert, unrevert };
}

/** Compact (context compression) icon button for the header Zone A. */
export function CompactButton({
  busy,
  disabled,
  onClick,
}: {
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      title="コンテキスト圧縮 (compact)"
      busy={busy}
      disabled={disabled}
      onClick={onClick}
    >
      <Shrink className="h-4 w-4" />
    </Button>
  );
}

/** Put this user comment into the composer and revert from here onward. */
const REVERT_BUTTON_BASE =
  "inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-faint transition-colors hover:bg-surface-2 hover:text-muted active:bg-surface-3 active:text-text disabled:opacity-40 min-h-[28px] min-w-[44px] touch-manipulation";

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
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return (
    <div className="flex max-w-full flex-col items-end gap-1">
      <button
        type="button"
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        title="このコメントを入力欄に戻して巻き戻す"
        onClick={() => {
          void (async () => {
            if (busyRef.current) return;
            if (
              !window.confirm(
                "このコメントを下の入力欄に戻し、ここ以降を巻き戻しますか？",
              )
            ) {
              return;
            }
            busyRef.current = true;
            setBusy(true);
            setError(null);
            try {
              const text = await revertUserMessageToComposer(
                directory,
                sessionId,
                messageId,
                messages,
              );
              if (!mountedRef.current) return;
              onRestoreText?.(text);
              onDone?.();
            } catch (err) {
              if (mountedRef.current) setError(
                err instanceof Error ? err.message : "巻き戻しに失敗しました",
              );
            } finally {
              busyRef.current = false;
              if (mountedRef.current) setBusy(false);
            }
          })();
        }}
        className={REVERT_BUTTON_BASE}
      >
        <RotateCcw className={busy ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
        入力欄に戻す
      </button>
      {error && (
        <p role="alert" className="max-w-[min(22rem,80vw)] break-words text-right text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
