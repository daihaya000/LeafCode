/**
 * Pure helpers to aggregate Codex token usage from session rollout logs
 * (the ".jsonl" files under ~/.codex/sessions). Each "token_count" event
 * carries a cumulative "total_token_usage" for that session; the last one in a
 * file is the session's final total. Summing finals across sessions gives the
 * grand total.
 *
 * No Node/DOM deps: the server wrapper does the filesystem work and delegates
 * parsing/summing here so it can be unit-tested.
 */

export type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type CodexTokensResult = {
  available: boolean;
  reason: string | null;
  days: number;
  sessions: number;
  totals: TokenUsage;
  generatedAt: string;
};

export function zeroUsage(): TokenUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Parse one JSONL line; return its `total_token_usage` when it is a
 * `token_count` event, else null. Never throws.
 */
export function parseTokenCountLine(line: string): TokenUsage | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== "{") return null;
  if (!trimmed.includes("token_count")) return null; // cheap pre-filter
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const payload = (obj as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return null;
  if ((payload as { type?: unknown }).type !== "token_count") return null;
  const info = (payload as { info?: unknown }).info;
  if (!info || typeof info !== "object") return null;
  const total = (info as { total_token_usage?: unknown }).total_token_usage;
  if (!total || typeof total !== "object") return null;
  const t = total as Record<string, unknown>;
  return {
    inputTokens: num(t.input_tokens),
    cachedInputTokens: num(t.cached_input_tokens),
    outputTokens: num(t.output_tokens),
    reasoningOutputTokens: num(t.reasoning_output_tokens),
    totalTokens: num(t.total_tokens),
  };
}

/** The last `token_count` cumulative usage in a file's text, or null. */
export function lastTokenUsageFromText(text: string): TokenUsage | null {
  let last: TokenUsage | null = null;
  for (const line of text.split("\n")) {
    const parsed = parseTokenCountLine(line);
    if (parsed) last = parsed;
  }
  return last;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningOutputTokens: a.reasoningOutputTokens + b.reasoningOutputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

export function sumUsage(list: TokenUsage[]): TokenUsage {
  return list.reduce(addUsage, zeroUsage());
}

/** Compact token count: 950 / 18.3k / 1.24M. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
