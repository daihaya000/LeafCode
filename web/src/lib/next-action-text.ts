/**
 * Pure helpers for the NextAction feature:
 * - Format a conversation transcript into a prompt for the suggestion model.
 * - Normalize a raw model response into a single user instruction.
 *
 * These functions have no side effects and do not touch the filesystem,
 * network, or any OpenCode session. They are covered by unit tests.
 */

import { buildTranscript } from "./session-title";
import type { MessageWithParts } from "./types";

/** Hard cap on the conversation text sent to the suggestion model. */
export const NEXT_ACTION_TRANSCRIPT_MAX_CHARS = 16_000;

/** Hard cap on the final suggestion length returned to the UI. */
export const NEXT_ACTION_SUGGESTION_MAX_CHARS = 500;

/**
 * Hard cap on how many previous suggestions are sent back on regeneration.
 * Sized for several multi-suggestion generations (up to 3 per generation)
 * so regeneration can exclude every suggestion still visible to the user.
 */
export const NEXT_ACTION_PREVIOUS_MAX_COUNT = 10;

/** Minimum number of suggestions the API generates per request. */
export const NEXT_ACTION_COUNT_MIN = 1;

/** Maximum number of suggestions the API generates per request. */
export const NEXT_ACTION_COUNT_MAX = 3;

/** Default number of suggestions (initial generation). */
export const NEXT_ACTION_COUNT_DEFAULT = 1;

/**
 * Sanitize the client-supplied suggestion count into a safe integer within
 * [NEXT_ACTION_COUNT_MIN, NEXT_ACTION_COUNT_MAX]. Accepts numbers and
 * numeric strings; anything invalid (non-numeric, NaN, Infinity) falls back
 * to {@link NEXT_ACTION_COUNT_DEFAULT}. Fractional values are floored before
 * clamping, so e.g. 2.9 → 2, 0 → 1, 99 → 3.
 */
export function sanitizeSuggestionCount(input: unknown): number {
  let n: number;
  if (typeof input === "number") {
    n = input;
  } else if (typeof input === "string" && input.trim() !== "") {
    n = Number(input);
  } else {
    return NEXT_ACTION_COUNT_DEFAULT;
  }
  if (!Number.isFinite(n)) return NEXT_ACTION_COUNT_DEFAULT;
  n = Math.floor(n);
  if (n < NEXT_ACTION_COUNT_MIN) return NEXT_ACTION_COUNT_MIN;
  if (n > NEXT_ACTION_COUNT_MAX) return NEXT_ACTION_COUNT_MAX;
  return n;
}

/**
 * System instruction for the temporary NextAction session. It must produce a
 * single actionable Japanese user instruction with no preamble, no headings,
 * no multiple candidates, and no markdown.
 */
export const NEXT_ACTION_SYSTEM_INSTRUCTION = [
  "あなたはユーザーの次の一手を提案するアシスタントです。",
  "以下の会話履歴に基づいて、ユーザーが次に送るべき指示を1件だけ出力してください。",
  "ルール:",
  "- 日本語で書く",
  "- 実行可能な1件のユーザー指示のみを出力する",
  "- 説明・前置き・見出し・番号付け・候補の列挙は禁止",
  "- 未回答の質問・未解決の失敗・残タスクがあれば最優先で触れる",
  "- 明確な次工程がない場合は直近の成果の確認・テスト・レビュー・コミットなど目的に沿う最小の次工程を提案する",
  "- 存在しない結果や確認できない事実を前提にしない",
  "- 既出の提案が提示されている場合は、それらと同一または表現を変えただけの実質的に重複する指示を避け、別の観点の次工程を提案する",
  "- 出力は指示文1件だけ。余計な文字・引用符・改行を含めない",
].join("\n");

/**
 * Sanitize client-supplied previous suggestions (sent on regeneration) into
 * a bounded list of clean strings:
 *
 * - Rejects anything that is not an array of strings.
 * - Trims entries and drops empty ones.
 * - Caps each entry to {@link NEXT_ACTION_SUGGESTION_MAX_CHARS} code points.
 * - Deduplicates exact matches.
 * - Keeps at most {@link NEXT_ACTION_PREVIOUS_MAX_COUNT} entries.
 */
export function sanitizePreviousSuggestions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    let s = item.trim();
    if (!s) continue;
    const cps = Array.from(s);
    if (cps.length > NEXT_ACTION_SUGGESTION_MAX_CHARS) {
      s = cps.slice(0, NEXT_ACTION_SUGGESTION_MAX_CHARS).join("");
    }
    if (out.includes(s)) continue;
    out.push(s);
    if (out.length >= NEXT_ACTION_PREVIOUS_MAX_COUNT) break;
  }
  return out;
}

/**
 * Render the exclusion block appended to the prompt on regeneration. It
 * lists suggestions already shown to the user and instructs the model to
 * avoid identical or substantially overlapping proposals. Returns an empty
 * string when there are no previous suggestions (initial generation).
 */
export function formatPreviousSuggestionsBlock(
  previousSuggestions: string[],
): string {
  if (previousSuggestions.length === 0) return "";
  const list = previousSuggestions.map((s) => `- ${s}`).join("\n");
  return [
    "",
    "",
    "【避けるべき既出の提案】",
    "以下の提案はすでに表示済みです。これらと同一、または表現を変えただけで実質的に同じ作業を指示する内容は避け、別の観点の具体的で実行可能な指示を1件だけ出力してください。",
    list,
  ].join("\n");
}

/**
 * Build the user prompt body from a conversation transcript. The transcript
 * is truncated to {@link NEXT_ACTION_TRANSCRIPT_MAX_CHARS} with recent
 * messages prioritised (done by buildTranscript).
 *
 * When `previousSuggestions` is non-empty (regeneration), an exclusion block
 * listing them is appended so the model avoids repeating already-shown
 * suggestions. Initial generation (no previous suggestions) is unchanged.
 */
export function formatConversationForPrompt(
  messages: MessageWithParts[],
  previousSuggestions: string[] = [],
): string {
  const transcript = buildTranscript(
    messages,
    NEXT_ACTION_TRANSCRIPT_MAX_CHARS,
  );
  if (!transcript.trim()) return "";
  return (
    `以下の会話履歴に基づいて、次に送るべき指示を1件だけ出力してください。\n\n---\n${transcript}\n---` +
    formatPreviousSuggestionsBlock(previousSuggestions)
  );
}

/**
 * Normalize a raw model response into a single suggestion string.
 *
 * - Strips surrounding whitespace and common wrapping quotes/backticks.
 * - Takes the first non-empty line (no multi-paragraph output).
 * - Drops leading numbering ("1. ", "・", "- ") and bullet markers.
 * - Caps to {@link NEXT_ACTION_SUGGESTION_MAX_CHARS} code points.
 * - Returns empty string when nothing actionable remains.
 */
export function normalizeSuggestion(raw: string): string {
  if (!raw) return "";
  let s = raw.trim();
  // Strip surrounding quotes / code fences that models sometimes emit.
  const pairs: [string, string][] = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["「", "」"],
    ["『", "』"],
  ];
  for (const [open, close] of pairs) {
    if (s.startsWith(open) && s.endsWith(close) && s.length >= 2) {
      s = s.slice(open.length, s.length - close.length).trim();
      break;
    }
  }
  // Take the first non-empty line.
  const firstLine =
    s
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  if (!firstLine) return "";
  // Drop leading numbering / bullets.
  s = firstLine.replace(/^(?:\d+[.)]\s*|[-*・]\s*)+/, "").trim();
  if (!s) return "";
  // Cap by code points so UI layout stays predictable.
  const cps = Array.from(s);
  if (cps.length > NEXT_ACTION_SUGGESTION_MAX_CHARS) {
    s = cps.slice(0, NEXT_ACTION_SUGGESTION_MAX_CHARS).join("");
  }
  return s.trim();
}

/**
 * Extract the assistant text from a synchronous prompt response. The
 * OpenCode `/session/{id}/prompt` response shape is
 * `{ info: AssistantMessage, parts: Part[] }`. The first text part is the
 * suggestion candidate.
 */
export function extractAssistantText(response: {
  parts?: { type?: string; text?: string }[];
}): string {
  const parts = response?.parts ?? [];
  for (const p of parts) {
    if (p?.type === "text" && typeof p.text === "string" && p.text.trim()) {
      return p.text;
    }
  }
  return "";
}
