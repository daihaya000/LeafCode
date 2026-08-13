import { useState } from "react";
import { type ComposerAttachment } from "@/components/Composer";

/**
 * TaskView の Composer 送信 state（REFACTORING_PLAN 5-b / IMPROVEMENT 1-1）。
 * 入力・送信エラー・通知・配信モード・フォローアップキュー・送信中フラグ・
 * 添付・タスク操作中の busy を集約する。送信ロジック（send 本体）は TaskView 側に残す。
 */
export type Attachment = ComposerAttachment;
export type DeliveryMode = "steer" | "queue";
export type QueuedFollowUp = {
  id: number;
  text: string;
  attachments: Attachment[];
  /** Composer scope that enqueued this item — never drain on another session. */
  scopeKey: string;
};

export function useComposerSend() {
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [tokenSavingNotice, setTokenSavingNotice] = useState<string | null>(null);
  const [dismissedSessionError, setDismissedSessionError] = useState<string | null>(
    null,
  );
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("queue");
  const [queuedFollowUps, setQueuedFollowUps] = useState<QueuedFollowUp[]>([]);
  const [queuedAutoSend, setQueuedAutoSend] = useState(false);
  const [taskActionBusy, setTaskActionBusy] = useState<
    "remove" | "session" | "restore" | "workflow" | null
  >(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  /** POST in flight for the manual "再開" of an interrupted/silent turn. */
  const [resumingTurn, setResumingTurn] = useState(false);
  const [resumeTurnError, setResumeTurnError] = useState<string | null>(null);
  /** Scope that owns the in-flight send — other sessions must stay editable. */
  const [sendingScopeKey, setSendingScopeKey] = useState<string | null>(null);

  return {
    input,
    setInput,
    sendError,
    setSendError,
    tokenSavingNotice,
    setTokenSavingNotice,
    dismissedSessionError,
    setDismissedSessionError,
    deliveryMode,
    setDeliveryMode,
    queuedFollowUps,
    setQueuedFollowUps,
    queuedAutoSend,
    setQueuedAutoSend,
    taskActionBusy,
    setTaskActionBusy,
    attachments,
    setAttachments,
    sending,
    setSending,
    resumingTurn,
    setResumingTurn,
    resumeTurnError,
    setResumeTurnError,
    sendingScopeKey,
    setSendingScopeKey,
  };
}
