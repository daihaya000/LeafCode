import type { MessageWithParts } from "./types";

export type ModelRankingEntry = {
  providerID: string;
  modelID: string;
  sessions: number;
  turns: number;
  tokens: number;
  cost: number;
  tokensPerDollar: number | null;
};

type ModelUsage = {
  sessions: Set<string>;
  turns: number;
  tokens: number;
  cost: number;
};

/**
 * Aggregate assistant history by the model that produced each turn.
 * Cost is OpenCode's reported message cost; no client-side price estimation is
 * performed. Entries without a provider or model are intentionally excluded.
 */
export function rankModelUsage(
  histories: readonly { sessionId: string; messages: MessageWithParts[] }[],
): ModelRankingEntry[] {
  const usage = new Map<string, ModelUsage>();

  for (const history of histories) {
    for (const message of history.messages) {
      const info = message.info;
      if (info.role !== "assistant" || !info.providerID || !info.modelID) {
        continue;
      }
      const key = `${info.providerID}::${info.modelID}`;
      const current = usage.get(key) ?? {
        sessions: new Set<string>(),
        turns: 0,
        tokens: 0,
        cost: 0,
      };
      current.sessions.add(history.sessionId);
      current.turns += 1;
      current.tokens += Math.max(0, info.tokens?.output ?? 0) + Math.max(0, info.tokens?.reasoning ?? 0);
      current.cost += Math.max(0, info.cost ?? 0);
      usage.set(key, current);
    }
  }

  return [...usage.entries()]
    .map(([key, value]) => {
      const separator = key.indexOf("::");
      const cost = value.cost;
      return {
        providerID: key.slice(0, separator),
        modelID: key.slice(separator + 2),
        sessions: value.sessions.size,
        turns: value.turns,
        tokens: value.tokens,
        cost,
        tokensPerDollar: cost > 0 ? value.tokens / cost : null,
      };
    })
    .sort((a, b) => {
      if (a.tokensPerDollar === null) return b.tokensPerDollar === null ? 0 : 1;
      if (b.tokensPerDollar === null) return -1;
      return b.tokensPerDollar - a.tokensPerDollar;
    });
}
