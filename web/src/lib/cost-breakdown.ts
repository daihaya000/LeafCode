/**
 * Per-model cost breakdown for a session, used by the task header tooltip.
 *
 * Each assistant turn carries the model that produced it, so the session's
 * cumulative cost can be split by model. A turn's cost is the one OpenCode
 * reported; when it reports none we fall back to the same token-price estimate
 * the per-message meta header uses, so the breakdown matches what the UI shows
 * elsewhere.
 */

import { lookupModelPricing } from "./model-pricing-registry";
import { estimateOpenAIApiCost } from "./openai-pricing";
import type { MessageInfo, MessageWithParts } from "./types";

export type CostBreakdownEntry = {
  /** Model that produced the turns, or `null` for the unattributed remainder. */
  modelID: string | null;
  cost: number;
};

/** Costs below this (USD) are rounding noise and never get their own line. */
const EPSILON = 1e-6;

/** Cost of one assistant turn: the reported cost, else a pricing estimate. */
export function assistantTurnCost(info: MessageInfo): number {
  if (info.role !== "assistant") return 0;
  const reported = info.cost ?? 0;
  if (reported > 0) return reported;
  const estimate = estimateOpenAIApiCost(
    info,
    lookupModelPricing(info.providerID, info.modelID),
  );
  return estimate !== null && estimate > 0 ? estimate : 0;
}

/**
 * Split the loaded assistant turns by model, highest spend first.
 * Turns with no model ID are folded into the unattributed (`null`) entry.
 */
export function costBreakdownByModel(
  messages: readonly MessageWithParts[],
): CostBreakdownEntry[] {
  const byModel = new Map<string | null, number>();
  for (const message of messages) {
    const cost = assistantTurnCost(message.info);
    if (cost <= 0) continue;
    const modelID = message.info.modelID || null;
    byModel.set(modelID, (byModel.get(modelID) ?? 0) + cost);
  }
  return [...byModel.entries()]
    .filter(([, cost]) => cost > EPSILON)
    .map(([modelID, cost]) => ({ modelID, cost }))
    .sort((a, b) => b.cost - a.cost);
}

/**
 * Tooltip lines for the cumulative cost badge.
 *
 * `total` is the authoritative session cost, which can exceed the sum of the
 * loaded turns (older turns trimmed from the stream, sub-agent child sessions).
 * The difference is shown as "その他" so the lines always add up to the badge.
 * Returns an empty list when nothing can be attributed, so the caller can keep
 * the plain tooltip instead of showing a single meaningless line.
 */
export function costBreakdownLines(
  entries: readonly CostBreakdownEntry[],
  total: number,
  formatCost: (cost: number) => string,
): string[] {
  if (entries.length === 0) return [];
  const attributed = entries.reduce((sum, entry) => sum + entry.cost, 0);
  const lines = entries.map(
    (entry) => `${entry.modelID ?? "モデル不明"}: ${formatCost(entry.cost)}`,
  );
  const remainder = total - attributed;
  if (remainder > EPSILON) {
    lines.push(`その他: ${formatCost(remainder)}`);
  }
  return lines;
}
