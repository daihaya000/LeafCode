import type { MessageWithParts } from "./types";
import type { ProviderModelMeta } from "./model-variants";

export type ContextUsage = {
  /** Tokens the model actually holds in context after the most recent turn. */
  used: number;
  /** The model's context window size, from provider metadata. */
  limit: number;
  /** used/limit as a whole-number percentage, capped at 100. */
  pct: number;
};

/**
 * Derive context-window usage from the most recent assistant turn's token
 * usage against that model's known context limit.
 *
 * This intentionally looks at the LAST assistant message only, not a sum
 * across the session: each turn's `tokens.input`/`cache` already reflects
 * the full conversation history sent to the model for that turn, so it is
 * the correct snapshot of "how full is the context window right now".
 * Summing across turns would double-count history and only ever grow,
 * which would not represent context occupancy.
 *
 * Returns `null` when there is no assistant message with token usage yet,
 * or when the context limit for that turn's model is unknown.
 */
export function computeContextUsage(
  messages: MessageWithParts[],
  providerModelsMap: Record<string, ProviderModelMeta>,
): ContextUsage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const info = messages[i]?.info;
    if (info?.role !== "assistant" || !info.tokens) continue;
    const key =
      info.providerID && info.modelID
        ? `${info.providerID}::${info.modelID}`
        : "";
    const limit = providerModelsMap[key]?.limit?.context;
    if (!limit || limit <= 0) return null;
    const t = info.tokens;
    const used =
      t.total ??
      (t.input ?? 0) +
        (t.output ?? 0) +
        (t.reasoning ?? 0) +
        (t.cache?.read ?? 0) +
        (t.cache?.write ?? 0);
    return { used, limit, pct: Math.min(100, Math.round((used / limit) * 100)) };
  }
  return null;
}
