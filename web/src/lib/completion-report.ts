/**
 * Pure helpers to detect when the assistant's latest message reads like a
 * completion report, per this project's AGENTS.md convention (agents write a
 * "完了報告" heading before the final summary — see the ToDo/git status
 * checks in the primary agent's prompt). Used to scope "finished but ToDo/
 * git status left dirty" warnings so they only fire at the moment the agent
 * claims to be done, not on every idle turn.
 */

import type { MessageWithParts } from "./types";

/** Concatenated text of a message's text parts, in part order. Skips
 * synthetic parts (echoed prompts etc.), matching session-title.ts's
 * buildTranscript convention. */
export function messageText(message: MessageWithParts): string {
  return message.parts
    .filter((p) => p.type === "text" && !p.synthetic && typeof p.text === "string")
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

/**
 * True when `text` looks like a completion report — i.e. it contains a
 * "完了報告" heading line on its own (optionally prefixed with Markdown `#`
 * marks), not merely a passing mention of the phrase in prose. Anchoring to
 * a standalone line avoids false positives when the assistant discusses this
 * very convention (e.g. "「完了報告」というルールを追加しました") without
 * actually delivering one.
 */
export function looksLikeCompletionReport(text: string): boolean {
  // `\s` doesn't cover U+3000 (full-width space), which is common padding
  // around a Japanese heading — match it explicitly alongside ASCII whitespace.
  return /^[\s　]*#{0,6}[\s　]*完了報告[\s　]*$/m.test(text);
}
