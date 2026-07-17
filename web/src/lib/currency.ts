/**
 * Cost display currency preference.
 * OpenCode reports message cost in USD; JPY is a client-side conversion.
 */

export type CostCurrency = "USD" | "JPY";

export type CostDisplayPrefs = {
  currency: CostCurrency;
  /** Yen per 1 USD. Used only when currency is JPY. */
  usdJpyRate: number;
};

const STORAGE_KEY = "webui:cost-display";
export const COST_DISPLAY_EVENT = "webui:cost-display";

/** Sensible default; user can override in Settings. */
export const DEFAULT_USD_JPY_RATE = 150;

export const DEFAULT_COST_PREFS: CostDisplayPrefs = {
  currency: "USD",
  usdJpyRate: DEFAULT_USD_JPY_RATE,
};

const MIN_RATE = 1;
const MAX_RATE = 1000;

export function clampUsdJpyRate(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_USD_JPY_RATE;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, n));
}

export function sanitizeCostDisplayPrefs(raw: unknown): CostDisplayPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_COST_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  const currency: CostCurrency = obj.currency === "JPY" ? "JPY" : "USD";
  const rate =
    typeof obj.usdJpyRate === "number"
      ? obj.usdJpyRate
      : typeof obj.usdJpyRate === "string"
        ? Number(obj.usdJpyRate)
        : DEFAULT_USD_JPY_RATE;
  return {
    currency,
    usdJpyRate: clampUsdJpyRate(rate),
  };
}

export function readCostDisplayPrefs(): CostDisplayPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_COST_PREFS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_COST_PREFS };
    return sanitizeCostDisplayPrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_COST_PREFS };
  }
}

export function writeCostDisplayPrefs(prefs: CostDisplayPrefs): void {
  const next = sanitizeCostDisplayPrefs(prefs);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(
      new CustomEvent(COST_DISPLAY_EVENT, { detail: next }),
    );
  } catch {
    /* ignore */
  }
}

function formatYen(usd: number, usdJpyRate: number): string {
  const yen = usd * clampUsdJpyRate(usdJpyRate);
  if (yen < 1) return `¥${yen.toFixed(2)}`;
  if (yen < 100) return `¥${yen.toFixed(1)}`;
  return `¥${Math.round(yen).toLocaleString("ja-JP")}`;
}

/** Format a USD cost for display according to prefs. */
export function formatCost(
  usd: number,
  prefs: CostDisplayPrefs = DEFAULT_COST_PREFS,
): string {
  if (!Number.isFinite(usd) || usd <= 0) return "";
  const usdLabel = `$${usd.toFixed(4)}`;
  if (prefs.currency !== "JPY") {
    return `cost ${usdLabel}`;
  }
  return `cost ${formatYen(usd, prefs.usdJpyRate)}（${usdLabel}）`;
}
