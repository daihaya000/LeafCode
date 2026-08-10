import type { MessageWithParts } from "./types";

/**
 * Token usage breakdown for a single assistant turn.
 *
 * `input` is the prompt-token count (what the model consumed this turn),
 * `cacheRead` / `cacheWrite` are the cache hit/miss portions of that input,
 * `output` and `reasoning` are the generated tokens, and `total` is the
 * provider-reported grand total when available.
 */
export type TurnTokenUsage = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  total: number;
  /** Whole-number percentage of input tokens served from cache, 0–100. */
  cacheHitPct: number;
};

/**
 * Extract the token-usage breakdown from the most recent assistant turn.
 *
 * This mirrors `computeContextUsage` in looking at the LAST assistant
 * message only, because each turn's `tokens.input` already reflects the
 * full conversation history for that turn. Returns `null` when no
 * assistant message with token usage exists.
 *
 * The function never logs or persists message content; it only reads the
 * numeric `info.tokens` fields that OpenCode already reported.
 */
export function lastTurnTokenUsage(
  messages: MessageWithParts[],
): TurnTokenUsage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const info = messages[i]?.info;
    if (info?.role !== "assistant" || !info.tokens) continue;
    const t = info.tokens;
    const input = Math.max(0, t.input ?? 0);
    const cacheRead = Math.max(0, t.cache?.read ?? 0);
    const cacheWrite = Math.max(0, t.cache?.write ?? 0);
    const output = Math.max(0, t.output ?? 0);
    const reasoning = Math.max(0, t.reasoning ?? 0);
    const total =
      t.total ??
      input + output + reasoning + cacheRead + cacheWrite;
    // Skip zero-usage trailing records the same way computeContextUsage does:
    // a turn that reports no tokens did not produce a real response.
    if (
      input === 0 &&
      cacheRead === 0 &&
      cacheWrite === 0 &&
      output === 0 &&
      reasoning === 0 &&
      (t.total ?? 0) === 0
    ) {
      continue;
    }
    const cacheHitPct =
      input + cacheRead > 0
        ? Math.min(100, Math.round((cacheRead / (input + cacheRead)) * 100))
        : 0;
    return {
      input,
      cacheRead,
      cacheWrite,
      output,
      reasoning,
      total: Math.max(0, total),
      cacheHitPct,
    };
  }
  return null;
}

/**
 * Aggregate token usage across all assistant turns in a session.
 *
 * Unlike `lastTurnTokenUsage`, this sums every assistant message, which
 * represents the cumulative token spend of the session. Each turn's
 * `input` includes the full history sent for that turn, so the sum
 * over-counts history tokens — but it is the correct measure of
 * cumulative *billing*, since providers charge per-turn.
 */
export function cumulativeTokenUsage(
  messages: MessageWithParts[],
): TurnTokenUsage {
  let input = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let output = 0;
  let reasoning = 0;
  let total = 0;
  for (const message of messages) {
    const info = message.info;
    if (info.role !== "assistant" || !info.tokens) continue;
    const t = info.tokens;
    input += Math.max(0, t.input ?? 0);
    cacheRead += Math.max(0, t.cache?.read ?? 0);
    cacheWrite += Math.max(0, t.cache?.write ?? 0);
    output += Math.max(0, t.output ?? 0);
    reasoning += Math.max(0, t.reasoning ?? 0);
    total += Math.max(
      0,
      t.total ?? 0,
    );
  }
  const cacheHitPct =
    input + cacheRead > 0
      ? Math.min(100, Math.round((cacheRead / (input + cacheRead)) * 100))
      : 0;
  return {
    input,
    cacheRead,
    cacheWrite,
    output,
    reasoning,
    total,
    cacheHitPct,
  };
}