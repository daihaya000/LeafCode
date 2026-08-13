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

/** Provider/model a session is running on. */
export type SessionModel = { providerID: string; modelID: string };

/**
 * The model that most recently answered in this session.
 *
 * Compaction needs it: the implemented engine endpoint
 * (`POST /session/{id}/summarize`) requires `{ providerID, modelID }` and does
 * not infer the summarizing model. The last assistant turn is the same anchor
 * {@link computeContextUsage} measures, so the model that filled the context
 * is the model asked to summarize it.
 *
 * Returns `null` for a session with no assistant reply carrying model info.
 */
export function sessionModelFromMessages(
  messages: MessageWithParts[],
): SessionModel | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const info = messages[i]?.info;
    if (info?.role !== "assistant") continue;
    if (!info.providerID || !info.modelID) continue;
    return { providerID: info.providerID, modelID: info.modelID };
  }
  return null;
}

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
    const t = info.tokens;
    const used =
      t.total ??
      (t.input ?? 0) +
        (t.output ?? 0) +
        (t.reasoning ?? 0) +
        (t.cache?.read ?? 0) +
        (t.cache?.write ?? 0);
    if (used === 0) continue;
    const key =
      info.providerID && info.modelID
        ? `${info.providerID}::${info.modelID}`
        : "";
    const limit = providerModelsMap[key]?.limit?.context;
    if (!limit || limit <= 0) return null;
    return { used, limit, pct: Math.min(100, Math.round((used / limit) * 100)) };
  }
  return null;
}
