"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Shrink } from "lucide-react";
import { Button } from "@/components/ui";
import type { ComposerAttachment } from "@/components/Composer";
import { ocJson } from "@/lib/client";
import { isImageFilePart } from "@/lib/message-parts";
import { isV2ApiGeneration } from "@/lib/opencode-generation";
import {
  activeCompactPath,
  activeRevertClearPath,
  activeRevertCommitPath,
  activeRevertStagePath,
} from "@/lib/opencode-paths";
import type { MessageWithParts } from "@/lib/types";

export async function revertMessage(
  directory: string,
  sessionId: string,
  messageID: string,
  partID?: string,
) {
  if (isV2ApiGeneration()) {
    // v2 splits the v1 single revert into stage → commit. The stage body takes
    // the message id; part-level revert has no v2 equivalent.
    await ocJson(activeRevertStagePath(sessionId), directory, {
      method: "POST",
      body: { messageID },
    });
    await ocJson(activeRevertCommitPath(sessionId), directory, {
      method: "POST",
      body: {},
    });
    return;
  }
  const body: Record<string, string> = { messageID };
  if (partID) body.partID = partID;
  await ocJson(activeRevertStagePath(sessionId), directory, {
    method: "POST",
    body,
  });
}

export async function unrevertSession(directory: string, sessionId: string) {
  await ocJson(activeRevertClearPath(sessionId), directory, {
    method: "POST",
    body: {},
  });
}

/**
 * Compact the session context via OpenCode's standard API. Shared by the
 * manual compact button and the automatic pre-send compact in TaskView.
 * Throws on failure so callers can restore the composer draft.
 */
export function isCompactionLockConflict(error: unknown): boolean {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  const message = error instanceof Error ? error.message : "";
  return status === 409 && message.includes("session compaction already in progress");
}

/** A failed compact may have been accepted before its response was lost. */
export function isAmbiguousCompactionFailure(error: unknown): boolean {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  return (
    status === undefined ||
    status === 408 ||
    status === 429 ||
    (typeof status === "number" && status >= 500 && status <= 599)
  );
}

export async function compactSession(
  directory: string,
  sessionId: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      await ocJson(activeCompactPath(sessionId), directory, {
        method: "POST",
        body: {},
      });
      return;
    } catch (error) {
      if (!isCompactionLockConflict(error) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

/** Collect plain text from a user message for the composer. */
export function messagePlainText(msg: MessageWithParts | undefined): string {
  if (!msg) return "";
  return msg.parts
    .filter((p) => p.type === "text" && p.text?.trim())
    .map((p) => p.text!.trim())
    .join("\n\n");
}

/** Collect image attachments from a user message for the composer. */
export function messageImageAttachments(
  msg: MessageWithParts | undefined,
): ComposerAttachment[] {
  if (!msg) return [];
  return msg.parts
    .filter((p) => isImageFilePart(p))
    .map((p) => ({
      uri: p.url,
      mime: p.mime ?? "",
      name: p.filename,
      preview: p.url,
    }));
}

/**
 * Undo from this user message onward (message is hidden), return its text
 * and image attachments so the caller can put them in the composer.
 */
export async function revertUserMessageToComposer(
  directory: string,
  sessionId: string,
  messageId: string,
  messages: MessageWithParts[],
): Promise<{ text: string; attachments: ComposerAttachment[] }> {
  const msg = messages.find((m) => m.info.id === messageId);
  if (!msg) throw new Error("対象メッセージが見つかりません");
  if (msg.info.role !== "user") {
    throw new Error("ユーザーメッセージのみ入力欄に戻せます");
  }
  const text = messagePlainText(msg);
  const attachments = messageImageAttachments(msg);
  if (!text && attachments.length === 0) throw new Error("戻す内容がありません");
  // Inclusive revert: hide this message and everything after
  await revertMessage(directory, sessionId, messageId);
  return { text, attachments };
}

export type SessionActionKey = "compact" | "revert" | "unrevert";

export function useSessionActions({
  directory,
  sessionId,
  lastUserMessageId,
  messages,
  onRestore,
  onDone,
}: {
  directory: string;
  sessionId: string;
  lastUserMessageId?: string | null;
  messages: MessageWithParts[];
  onRestore?: (text: string, attachments: ComposerAttachment[]) => void;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState<SessionActionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);
  const busyRef = useRef<SessionActionKey | null>(null);
  const mountedRef = useRef(false);
  const actionGenerationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    actionGenerationRef.current += 1;
    busyRef.current = null;
    setRevertConfirmOpen(false);
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
      await compactSession(directory, sessionId);
      return "ok" as const;
    });
  }, [run, directory, sessionId]);

  const revert = useCallback(() => {
    if (!lastUserMessageId || busyRef.current !== null) return;
    setRevertConfirmOpen(true);
  }, [lastUserMessageId]);

  const confirmRevert = useCallback(() => {
    if (!lastUserMessageId) {
      setRevertConfirmOpen(false);
      return;
    }
    setRevertConfirmOpen(false);
    void run("revert", async () => {
      const { text, attachments } = await revertUserMessageToComposer(
        directory,
        sessionId,
        lastUserMessageId,
        messages,
      );
      onRestore?.(text, attachments);
      return "ok" as const;
    });
  }, [run, directory, sessionId, lastUserMessageId, messages, onRestore]);

  const cancelRevert = useCallback(() => {
    setRevertConfirmOpen(false);
  }, []);

  const unrevert = useCallback(() => {
    void run("unrevert", async () => {
      await unrevertSession(directory, sessionId);
      return "ok" as const;
    });
  }, [run, directory, sessionId]);

  return {
    busy,
    error,
    compact,
    revert,
    confirmRevert,
    cancelRevert,
    revertConfirmOpen,
    unrevert,
  };
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
      aria-label="コンテキストを圧縮"
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
  onRestore,
  onDone,
}: {
  directory: string;
  sessionId: string;
  messageId: string;
  messages: MessageWithParts[];
  disabled?: boolean;
  onRestore?: (text: string, attachments: ComposerAttachment[]) => void;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const confirmRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!confirmOpen) {
      if (
        triggerRef.current?.isConnected &&
        (document.activeElement === document.body || document.activeElement === null)
      ) {
        triggerRef.current.focus();
      }
      triggerRef.current = null;
      return;
    }
    confirmRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setConfirmOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmOpen]);

  const performRevert = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const { text, attachments } = await revertUserMessageToComposer(
        directory,
        sessionId,
        messageId,
        messages,
      );
      if (!mountedRef.current) return;
      onRestore?.(text, attachments);
      onDone?.();
    } catch (err) {
      if (mountedRef.current) setError(
        err instanceof Error ? err.message : "巻き戻しに失敗しました",
      );
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <div className="flex max-w-full flex-col items-end gap-1">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || busy || confirmOpen}
        aria-busy={busy || undefined}
        aria-expanded={confirmOpen}
        aria-controls="message-revert-confirm"
        title="このコメントを入力欄に戻して巻き戻す"
        onClick={() => {
          triggerRef.current = document.activeElement instanceof HTMLButtonElement
            ? document.activeElement
            : null;
          setConfirmOpen(true);
        }}
        className={REVERT_BUTTON_BASE}
      >
        <RotateCcw className={busy ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
        入力欄に戻す
      </button>
      {confirmOpen && (
        <div
          ref={confirmRef}
          id="message-revert-confirm"
          role="dialog"
          aria-label="メッセージ巻き戻しの確認"
          aria-describedby="message-revert-confirm-description"
          className="max-w-[min(22rem,80vw)] rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-right text-[11px] text-warning"
        >
          <p id="message-revert-confirm-description">
            このコメントを入力欄に戻し、ここ以降を巻き戻しますか？
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setConfirmOpen(false);
                void performRevert();
              }}
            >
              巻き戻す
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmOpen(false)}
            >
              キャンセル
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="max-w-[min(22rem,80vw)] break-words text-right text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
