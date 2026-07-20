export type UsdJpyQuote = {
  rate: number;
  asOf: string;
  source: "frankfurter";
};

const FRANKFURTER_URL =
  "https://api.frankfurter.app/latest?from=USD&to=JPY";

/** Cap Frankfurter wait so a hung upstream cannot pin a BFF worker. */
const FRANKFURTER_TIMEOUT_MS = 8_000;

const MIN_RATE = 1;
const MAX_RATE = 1000;

let cache: { dateKey: string; quote: UsdJpyQuote } | null = null;

export function jstDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function getCachedUsdJpyQuote(): UsdJpyQuote | null {
  const key = jstDateKey();
  if (cache?.dateKey === key) {
    return cache.quote;
  }
  return null;
}

export function setCachedUsdJpyQuote(quote: UsdJpyQuote, dateKey: string): void {
  cache = { dateKey, quote };
}

export function clearUsdJpyQuoteCacheForTests(): void {
  cache = null;
}

function validateRate(rate: unknown): number {
  if (typeof rate !== "number" || !Number.isFinite(rate)) {
    throw new Error("invalid USD/JPY rate");
  }
  if (rate < MIN_RATE || rate > MAX_RATE) {
    throw new Error("USD/JPY rate out of range");
  }
  return rate;
}

type FrankfurterResponse = {
  date?: string;
  rates?: { JPY?: number };
};

export async function fetchUsdJpyQuote(
  fetchImpl: typeof fetch = fetch,
): Promise<UsdJpyQuote> {
  const dateKey = jstDateKey();
  const cached = getCachedUsdJpyQuote();
  if (cached) {
    return cached;
  }

  const res = await fetchImpl(FRANKFURTER_URL, {
    signal: AbortSignal.timeout(FRANKFURTER_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Frankfurter upstream error: ${res.status}`);
  }

  const body = (await res.json()) as FrankfurterResponse;
  const rate = validateRate(body.rates?.JPY);
  const asOf =
    typeof body.date === "string" && body.date.length > 0
      ? body.date
      : dateKey;

  const quote: UsdJpyQuote = {
    rate,
    asOf,
    source: "frankfurter",
  };

  setCachedUsdJpyQuote(quote, dateKey);
  return quote;
}
