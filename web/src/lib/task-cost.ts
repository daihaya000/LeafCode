import { ocServer, unwrapOcData } from "./oc-server";
import { activeSessionMessagePath } from "./opencode-paths";
import { estimateOpenAIApiCost, lookupModelPricing } from "./openai-pricing";
import { readProviderModelState } from "./provider-model-state";
import type { MessageInfo, MessageWithParts } from "./types";

export type SessionUsage = {
  cost?: number;
  tokens?: MessageInfo["tokens"];
  model?: { id?: string; providerID?: string; variant?: string };
};

export type SessionEntry = SessionUsage & { id: string; agent?: string };

type CachedSessionEstimate = {
  fingerprint: string;
  cost: number;
};

const sessionEstimateCache = new Map<string, CachedSessionEstimate>();
export const SESSION_ESTIMATE_CACHE_MAX = 256;
// Avoid serializing dozens of transcript requests for a busy workspace while
// also avoiding an unbounded burst against the OpenCode engine.
export const SESSION_COST_FETCH_CONCURRENCY = 4;

export function estimateSessionCost(session: SessionUsage): number | null {
  if (!session.tokens || !session.model?.providerID || !session.model.id) {
    return null;
  }
  const manual = lookupModelPricing(
    readProviderModelState().modelPricing,
    session.model.providerID,
    session.model.id,
  );
  return estimateOpenAIApiCost(
    {
      providerID: session.model.providerID,
      modelID: session.model.id,
      tokens: session.tokens,
    },
    manual,
  );
}

export function sessionUsageFingerprint(session: SessionUsage): string | null {
  if (!session.tokens || !session.model?.providerID || !session.model.id) {
    return null;
  }
  return JSON.stringify({
    model: {
      providerID: session.model.providerID,
      id: session.model.id,
    },
    tokens: session.tokens,
  });
}

export function hasPositiveTokenUsage(tokens: MessageInfo["tokens"]): boolean {
  if (!tokens) return false;
  return Boolean(
    tokens.input > 0 ||
      tokens.output > 0 ||
      tokens.reasoning > 0 ||
      (tokens.cache?.read ?? 0) > 0 ||
      (tokens.cache?.write ?? 0) > 0,
  );
}

export function exactMessageCost(messages: MessageWithParts[]): number | null {
  let total = 0;
  let observed = false;
  const pricing = readProviderModelState().modelPricing;
  for (const message of messages) {
    if (message.info.role !== "assistant") continue;
    const reported = message.info.cost;
    if (typeof reported === "number" && Number.isFinite(reported) && reported > 0) {
      total += reported;
      observed = true;
      continue;
    }
    const manual = lookupModelPricing(
      pricing,
      message.info.providerID,
      message.info.modelID,
    );
    const estimated = estimateOpenAIApiCost(message.info, manual);
    if (estimated !== null) {
      total += estimated;
      observed = true;
    } else if (hasPositiveTokenUsage(message.info.tokens)) {
      // A partial transcript estimate would undercount unknown models.
      return null;
    }
  }
  return observed && total > 0 ? total : null;
}

export async function estimateSessionCostWithCache(
  directory: string,
  session: SessionUsage & { id: string },
): Promise<number | null> {
  const aggregate = estimateSessionCost(session);
  if (aggregate === null) return null;
  const fingerprint = sessionUsageFingerprint(session);
  if (!fingerprint) return aggregate;

  const cacheKey = `${directory}\0${session.id}`;
  const cached = sessionEstimateCache.get(cacheKey);
  if (cached?.fingerprint === fingerprint) {
    sessionEstimateCache.delete(cacheKey);
    sessionEstimateCache.set(cacheKey, cached);
    return cached.cost;
  }

  let messages: MessageWithParts[];
  try {
    const raw = await ocServer<unknown>(
      directory,
      activeSessionMessagePath(session.id),
      { timeoutMs: 1_500 },
    );
    // v2 message endpoints wrap the list in `{ data: [...] }`.
    messages = unwrapOcData<MessageWithParts>(raw);
  } catch {
    // The aggregate estimate remains useful when the transcript is unavailable.
    return aggregate;
  }

  const cost = exactMessageCost(messages) ?? aggregate;
  sessionEstimateCache.delete(cacheKey);
  sessionEstimateCache.set(cacheKey, { fingerprint, cost });
  while (sessionEstimateCache.size > SESSION_ESTIMATE_CACHE_MAX) {
    const oldest = sessionEstimateCache.keys().next().value;
    if (typeof oldest !== "string") break;
    sessionEstimateCache.delete(oldest);
  }
  return cost;
}

export function __clearSessionEstimateCacheForTest(): void {
  sessionEstimateCache.clear();
}
