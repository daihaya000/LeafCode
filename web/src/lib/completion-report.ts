/**
 * Pure helpers to detect when the assistant's latest message reads like a
 * completion report, per this project's AGENTS.md convention (agents write a
 * "完了報告" heading before the final summary — see the ToDo/git status
 * checks in the primary agent's prompt). Used to scope "finished but ToDo/
 * git status left dirty" warnings so they only fire at the moment the agent
 * claims to be done, not on every idle turn.
 */

import type { MessageWithParts } from "./types";

/** Concatenated text of a message's text parts, in part order. */
export function messageText(message: MessageWithParts): string {
  return message.parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n");
}

/** Text of the most recent assistant message, or "" if there is none. */
export function lastAssistantText(messages: MessageWithParts[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.info.role === "assistant") return messageText(m);
  }
  return "";
}

/** True when `text` looks like a completion report ("完了報告" heading). */
export function looksLikeCompletionReport(text: string): boolean {
  return /完了報告/.test(text);
}
