import type { MessageWithParts } from "./types";

/**
 * 中断（abort）されたターンを手動で再開するための判定ロジック。
 *
 * OpenCode は `POST /session/{id}/abort` で止められたターンの assistant
 * メッセージに `MessageAbortedError` を付ける。手動停止・ハング watchdog に
 * よる停止・Goal Loop の停止のいずれも同じ error 名になるため、UI は原因を
 * 問わず「同じプロンプトを再送する」再開手段を提供する。
 *
 * React/browser API を持ち込まないので、TaskView のレンダリングと単体テストの
 * どちらからでも同じ判定を使える。
 */

/** OpenCode がターン中断時に付ける error 名。 */
export const MESSAGE_ABORTED_ERROR = "MessageAbortedError";

export type AbortedResumeTarget = {
  /** 中断された assistant メッセージ ID。ボタンの表示位置を決めるのに使う。 */
  messageId: string;
  /** 再送するプロンプト本文。 */
  text: string;
  /** 元のプロンプトに添付されていたファイル（画像など）。 */
  files: { uri: string; mime: string; name?: string }[];
  /** 中断されたターンを担当していた agent（あれば同じ agent で再送する）。 */
  agent?: string;
  /** 中断されたターンのモデル（あれば同じモデルで再送する）。 */
  model?: { providerID: string; modelID: string };
};

/** `MessageAbortedError` を持つ assistant メッセージかどうか。 */
export function isAbortedAssistantMessage(message: MessageWithParts): boolean {
  if (message.info.role !== "assistant") return false;
  return message.info.error?.name === MESSAGE_ABORTED_ERROR;
}

/** user メッセージの text パートを 1 つのプロンプト本文へまとめる。 */
function promptTextOf(message: MessageWithParts): string {
  return message.parts
    .filter((part) => part.type === "text" && !part.synthetic)
    .map((part) => part.text ?? "")
    .join("\n\n")
    .trim();
}

/** user メッセージの file パートを sendPrompt の `files` 形式へ戻す。 */
function promptFilesOf(
  message: MessageWithParts,
): { uri: string; mime: string; name?: string }[] {
  return message.parts.flatMap((part) => {
    if (part.type !== "file" || !part.url || !part.mime) return [];
    return [
      {
        uri: part.url,
        mime: part.mime,
        ...(part.filename ? { name: part.filename } : {}),
      },
    ];
  });
}

/**
 * 会話の最後が「中断された assistant ターン」なら、その再開に必要な情報を返す。
 *
 * 末尾に限定しているのは、過去の中断ターンから再送すると現在の文脈と噛み合わない
 * 作業を重複実行させてしまうため。会話が先へ進んだ（新しい user 送信や完了した
 * assistant 応答がある）中断ターンには再開ボタンを出さない。
 */
export function findAbortedResumeTarget(
  messages: MessageWithParts[],
): AbortedResumeTarget | null {
  const last = messages.at(-1);
  if (!last || !isAbortedAssistantMessage(last)) return null;

  for (let i = messages.length - 2; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (!candidate) continue;
    // 中断ターンの直前にある user メッセージが再送対象。間に別の assistant
    // メッセージが挟まる場合、その assistant は完了済みなので再開対象外。
    if (candidate.info.role === "assistant") return null;
    if (candidate.info.role !== "user") continue;
    const text = promptTextOf(candidate);
    // text の無いプロンプト（添付のみ等）は再送内容を復元できないので諦める。
    if (!text) return null;
    return {
      messageId: last.info.id,
      text,
      files: promptFilesOf(candidate),
      ...(last.info.agent ? { agent: last.info.agent } : {}),
      ...(last.info.providerID && last.info.modelID
        ? { model: { providerID: last.info.providerID, modelID: last.info.modelID } }
        : {}),
    };
  }
  return null;
}
