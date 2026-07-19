/**
 * Cost display currency preference.
 * OpenCode reports message cost in USD; JPY is a client-side conversion.
 */
import { useEffect, useState } from "react";

export type CostCurrency = "USD" | "JPY";

export type CostRateMode = "auto" | "manual";

export type CostDisplayPrefs = {
  currency: CostCurrency;
  rateMode: CostRateMode;
  /** Yen per 1 USD. Used only when currency is JPY. */
  usdJpyRate: number;
};

const STORAGE_KEY = "webui:cost-display";
export const COST_DISPLAY_EVENT = "webui:cost-display";

/** Sensible default; user can override in Settings. */
export const DEFAULT_USD_JPY_RATE = 150;

export const DEFAULT_COST_PREFS: CostDisplayPrefs = {
  currency: "JPY",
  rateMode: "auto",
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
  const currency: CostCurrency = obj.currency === "USD" ? "USD" : "JPY";
  const rateMode: CostRateMode = obj.rateMode === "auto" ? "auto" : "manual";
  const rate =
    typeof obj.usdJpyRate === "number"
      ? obj.usdJpyRate
      : typeof obj.usdJpyRate === "string"
        ? Number(obj.usdJpyRate)
        : DEFAULT_USD_JPY_RATE;
  return {
    currency,
    rateMode,
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

export function writeCostDisplayPrefs(prefs: Partial<CostDisplayPrefs>): void {
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

/** Bare amount string (no "cost " label), e.g. `$0.1542` or `¥23.1（$0.1542）`. */
export function formatCostValue(
  usd: number,
  prefs: CostDisplayPrefs = DEFAULT_COST_PREFS,
): string {
  if (!Number.isFinite(usd) || usd <= 0) return "";
  const usdLabel = `$${usd.toFixed(4)}`;
  if (prefs.currency !== "JPY") return usdLabel;
  return `${formatYen(usd, prefs.usdJpyRate)}（${usdLabel}）`;
}

/** Format a USD cost for display according to prefs. */
export function formatCost(
  usd: number,
  prefs: CostDisplayPrefs = DEFAULT_COST_PREFS,
): string {
  const value = formatCostValue(usd, prefs);
  return value ? `cost ${value}` : "";
}

/**
 * Live cost-display prefs, kept in sync with Settings via
 * `COST_DISPLAY_EVENT` (fired by `writeCostDisplayPrefs`). Client-only:
 * returns `DEFAULT_COST_PREFS` during SSR/first paint.
 */
export function useCostDisplayPrefs(): CostDisplayPrefs {
  const [prefs, setPrefs] = useState<CostDisplayPrefs>(DEFAULT_COST_PREFS);
  useEffect(() => {
    setPrefs(readCostDisplayPrefs());
    const onPrefs = (e: Event) => {
      const detail = (e as CustomEvent<CostDisplayPrefs>).detail;
      setPrefs(sanitizeCostDisplayPrefs(detail));
    };
    window.addEventListener(COST_DISPLAY_EVENT, onPrefs);
    return () => window.removeEventListener(COST_DISPLAY_EVENT, onPrefs);
  }, []);
  return prefs;
}
