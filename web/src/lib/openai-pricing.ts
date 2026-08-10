import type { MessageInfo } from "./types";

type TokenPrice = {
  input: number;
  cachedInput?: number;
  cacheWrite?: number;
  output: number;
};

// USD per 1M tokens. Source: https://platform.openai.com/docs/pricing
const STANDARD: Record<string, TokenPrice> = {
  "gpt-5.6-sol": { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 30 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 },
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.2": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5.1": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-4.1": { input: 2, cachedInput: 0.5, output: 8 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10 },
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  o3: { input: 2, cachedInput: 0.5, output: 8 },
  "o4-mini": { input: 1.1, cachedInput: 0.275, output: 4.4 },
  "o3-mini": { input: 1.1, cachedInput: 0.55, output: 4.4 },
};

const FAST: Record<string, TokenPrice> = {
  "gpt-5.6-sol": { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 60 },
  "gpt-5.6-terra": { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 24 },
  "gpt-5.6-luna": { input: 0.4, cachedInput: 0.04, cacheWrite: 0.5, output: 2.4 },
  "gpt-5.5": { input: 12.5, cachedInput: 1.25, output: 75 },
  "gpt-5.4": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-5.4-mini": { input: 1.5, cachedInput: 0.15, output: 9 },
  "gpt-5.2": { input: 3.5, cachedInput: 0.35, output: 28 },
  "gpt-5.1": { input: 2.5, cachedInput: 0.25, output: 20 },
  "gpt-5": { input: 2.5, cachedInput: 0.25, output: 20 },
  "gpt-5-mini": { input: 0.45, cachedInput: 0.045, output: 3.6 },
  "gpt-4.1": { input: 3.5, cachedInput: 0.875, output: 14 },
  "gpt-4.1-mini": { input: 0.7, cachedInput: 0.175, output: 2.8 },
  "gpt-4.1-nano": { input: 0.2, cachedInput: 0.05, output: 0.8 },
  "gpt-4o": { input: 4.25, cachedInput: 2.125, output: 17 },
  "gpt-4o-mini": { input: 0.25, cachedInput: 0.125, output: 1 },
  o3: { input: 3.5, cachedInput: 0.875, output: 14 },
  "o4-mini": { input: 2, cachedInput: 0.5, output: 8 },
};

/** Estimate direct OpenAI API token cost when OpenCode did not report one. */
export function estimateOpenAIApiCost(info: Pick<MessageInfo, "providerID" | "modelID" | "tokens">): number | null {
  if (info.providerID !== "openai" || !info.modelID || !info.tokens) return null;
  const fast = info.modelID.endsWith("-fast");
  const modelID = fast ? info.modelID.slice(0, -5) : info.modelID;
  const price = (fast ? FAST : STANDARD)[modelID];
  if (!price) return null;

  const input = Math.max(0, info.tokens.input || 0);
  const cacheRead = Math.max(0, info.tokens.cache?.read || 0);
  const cacheWrite = Math.max(0, info.tokens.cache?.write || 0);
  const uncachedInput = Math.max(0, input - cacheRead - cacheWrite);
  const output = Math.max(0, (info.tokens.output || 0) + (info.tokens.reasoning || 0));
  const cost =
    (uncachedInput * price.input +
      cacheRead * (price.cachedInput ?? price.input) +
      cacheWrite * (price.cacheWrite ?? price.input) +
      output * price.output) /
    1_000_000;
  return cost > 0 && Number.isFinite(cost) ? cost : null;
}
