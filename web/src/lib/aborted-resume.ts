import type { MessageWithParts } from "./types";

/**
 * 途中で終わったターンを手動で再開するための判定ロジック。
 *
 * 対象は 2 種類。
 * - `aborted`: `POST /session/{id}/abort` で止められたターン。assistant
 *   メッセージに `MessageAbortedError` が付く。手動停止・ハング watchdog による
 *   停止・Goal Loop の停止のいずれも同じ error 名になるため、原因は区別しない。
 * - `silent`: エンジンが応答本文を返さずターンを終えた場合（無言終了）。
 *   `hang-watchdog.ts` の `hasAssistantResponse()` と同じ基準で判定する。
 *
 * React/browser API を持ち込まないので、TaskView のレンダリングと単体テストの
 * どちらからでも同じ判定を使える。
 */

/** OpenCode がターン中断時に付ける error 名。 */
export const MESSAGE_ABORTED_ERROR = "MessageAbortedError";

/** 再開を提示する理由。UI の文言と aria-label を分けるために使う。 */
export type ResumeReason = "aborted" | "silent";

export type ResumableTurn = {
  reason: ResumeReason;
  /** 中断/無言終了した assistant メッセージ ID。UI の表示位置判定に使う。 */
  messageId: string;
  /** 再送するプロンプト本文。 */
  text: string;
  /** 元のプロンプトに添付されていたファイル（画像など）。 */
  files: { uri: string; mime: string; name?: string }[];
  /** そのターンを担当していた agent（あれば同じ agent で再送する）。 */
  agent?: string;
  /** そのターンのモデル（あれば同じモデルで再送する）。 */
  model?: { providerID: string; modelID: string };
};

/** `MessageAbortedError` を持つ assistant メッセージかどうか。 */
export function isAbortedAssistantMessage(message: MessageWithParts): boolean {
  if (message.info.role !== "assistant") return false;
  return message.info.error?.name === MESSAGE_ABORTED_ERROR;
}

/**
 * そのメッセージが「ターンの成果」と言えるかどうか。error / structured output /
 * 非空の text パートのいずれかを持つものを成果とみなす（`hang-watchdog.ts` の
 * `hasAssistantResponse()` と同じ基準）。
 */
function hasTurnOutput(message: MessageWithParts): boolean {
  if (message.info.role !== "assistant") return false;
  if (message.info.error || message.info.structured !== undefined) return true;
  return message.parts.some(
    (part) =>
      part.type === "text" && typeof part.text === "string" && part.text.trim() !== "",
  );
}

/** まだ動いているツールがある（エンジンの idle 誤報の隙間）。 */
function hasPendingTool(message: MessageWithParts): boolean {
  return message.parts.some(
    (part) =>
      part.type === "tool" &&
      (part.state?.status === "running" || part.state?.status === "pending"),
  );
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
 * 会話の**現在のターン**（直近の user プロンプト以降）が中断または無言終了で
 * 終わっているなら、その再開に必要な情報を返す。
 *
 * ターン単位で見るのは、1 ターンが複数の assistant メッセージに分割される
 * （step ごと・agent 切替・圧縮後など）ためで、中断メッセージの直前が assistant
 * であることは珍しくない。直近の user プロンプト以降の assistant はすべて同じ
 * ターンに属するので、そのプロンプトが再送対象になる。
 *
 * 呼び出し側はセッションが idle であること（`working === false`）を保証すること。
 * 進行中のターンは当然まだ本文を持たないため、この関数だけでは区別できない。
 */
export function findResumableTurn(
  messages: MessageWithParts[],
): ResumableTurn | null {
  let promptIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.info.role === "user") {
      promptIndex = i;
      break;
    }
  }
  if (promptIndex < 0) return null;

  const prompt = messages[promptIndex];
  const turn = messages.slice(promptIndex + 1);
  // ターンがまだ 1 通も生んでいない場合は、送信直後と区別できないので出さない。
  if (!prompt || turn.length === 0) return null;

  const text = promptTextOf(prompt);
  // text の無いプロンプト（添付のみ等）は再送内容を復元できないので諦める。
  if (!text) return null;

  const build = (
    source: MessageWithParts,
    reason: ResumeReason,
  ): ResumableTurn => ({
    reason,
    messageId: source.info.id,
    text,
    files: promptFilesOf(prompt),
    ...(source.info.agent ? { agent: source.info.agent } : {}),
    ...(source.info.providerID && source.info.modelID
      ? { model: { providerID: source.info.providerID, modelID: source.info.modelID } }
      : {}),
  });

  let lastAbort = -1;
  for (let i = turn.length - 1; i >= 0; i -= 1) {
    const message = turn[i];
    if (message && isAbortedAssistantMessage(message)) {
      lastAbort = i;
      break;
    }
  }
  if (lastAbort >= 0) {
    // 中断後に本文が出ているなら、そのターンは結果的に完了している。
    if (turn.slice(lastAbort + 1).some(hasTurnOutput)) return null;
    return build(turn[lastAbort]!, "aborted");
  }

  // 無言終了: 本文も structured output も error も無い。ただし走行中ツールが
  // 残っている間はまだ進行中なので出さない。
  if (turn.some(hasTurnOutput) || turn.some(hasPendingTool)) return null;
  return build(turn.at(-1)!, "silent");
}
