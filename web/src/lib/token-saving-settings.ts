/**
 * Token-saving settings: the auto-compact mode and threshold.
 *
 * Same two-layer scheme as `hang-timeout.ts`: localStorage is the source of
 * truth for synchronous reads (instant hydration, no request on first paint),
 * the server `settings` table is the durable backup shared across browsers.
 * Every read falls back to the documented default, so a missing, corrupted,
 * or unavailable value never blocks the composer.
 */

import { getJson, sendJson } from "./client";

export type TokenSavingMode = "off" | "suggest" | "auto";

export const TOKEN_SAVING_SETTING_KEY = "token-saving";
export const TOKEN_SAVING_THRESHOLD_KEY = "token-saving-threshold";
export const TOKEN_SAVING_EVENT = "webui:token-saving";
export const TOKEN_SAVING_THRESHOLD_EVENT = "webui:token-saving-threshold";

const MODE_STORAGE_KEY = "webui:token-saving";
const THRESHOLD_STORAGE_KEY = "webui:token-saving-threshold";

export const DEFAULT_TOKEN_SAVING_MODE: TokenSavingMode = "off";
export const DEFAULT_TOKEN_SAVING_THRESHOLD = 80;
export const MIN_TOKEN_SAVING_THRESHOLD = 70;
export const MAX_TOKEN_SAVING_THRESHOLD = 95;

const VALID_MODES: readonly TokenSavingMode[] = ["off", "suggest", "auto"];

export function isTokenSavingMode(value: unknown): value is TokenSavingMode {
  return typeof value === "string" && (VALID_MODES as readonly string[]).includes(value);
}

export function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TOKEN_SAVING_THRESHOLD;
  return Math.min(
    MAX_TOKEN_SAVING_THRESHOLD,
    Math.max(MIN_TOKEN_SAVING_THRESHOLD, Math.round(value)),
  );
}

export function readTokenSavingMode(): TokenSavingMode {
  if (typeof window === "undefined") return DEFAULT_TOKEN_SAVING_MODE;
  try {
    const raw = localStorage.getItem(MODE_STORAGE_KEY);
    return isTokenSavingMode(raw) ? raw : DEFAULT_TOKEN_SAVING_MODE;
  } catch {
    return DEFAULT_TOKEN_SAVING_MODE;
  }
}

export function writeTokenSavingMode(mode: TokenSavingMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    window.dispatchEvent(new CustomEvent(TOKEN_SAVING_EVENT, { detail: mode }));
  } catch {
    // Settings are best-effort when storage is unavailable.
  }
}

export function readTokenSavingThreshold(): number {
  if (typeof window === "undefined") return DEFAULT_TOKEN_SAVING_THRESHOLD;
  try {
    const raw = localStorage.getItem(THRESHOLD_STORAGE_KEY);
    const value = Number(raw);
    return raw && Number.isFinite(value) ? clampThreshold(value) : DEFAULT_TOKEN_SAVING_THRESHOLD;
  } catch {
    return DEFAULT_TOKEN_SAVING_THRESHOLD;
  }
}

export function writeTokenSavingThreshold(value: number): void {
  const normalized = clampThreshold(value);
  try {
    localStorage.setItem(THRESHOLD_STORAGE_KEY, String(normalized));
    window.dispatchEvent(
      new CustomEvent(TOKEN_SAVING_THRESHOLD_EVENT, { detail: normalized }),
    );
  } catch {
    // Settings are best-effort when storage is unavailable.
  }
}

export function subscribeTokenSaving(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === MODE_STORAGE_KEY ||
      event.key === THRESHOLD_STORAGE_KEY ||
      event.key === null
    ) {
      listener();
    }
  };
  window.addEventListener(TOKEN_SAVING_EVENT, listener);
  window.addEventListener(TOKEN_SAVING_THRESHOLD_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(TOKEN_SAVING_EVENT, listener);
    window.removeEventListener(TOKEN_SAVING_THRESHOLD_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export async function syncTokenSavingToServer(
  mode: TokenSavingMode,
  threshold: number,
): Promise<void> {
  try {
    await sendJson("PUT", `/api/settings/${TOKEN_SAVING_SETTING_KEY}`, {
      value: mode,
    });
    await sendJson("PUT", `/api/settings/${TOKEN_SAVING_THRESHOLD_KEY}`, {
      value: String(clampThreshold(threshold)),
    });
  } catch {
    // localStorage remains the synchronous source of truth.
  }
}

export async function readTokenSavingFromServer(): Promise<{
  mode?: TokenSavingMode;
  threshold?: number;
}> {
  const result: { mode?: TokenSavingMode; threshold?: number } = {};
  try {
    const [modeData, thresholdData] = await Promise.all([
      getJson<{ value: string | null }>(`/api/settings/${TOKEN_SAVING_SETTING_KEY}`),
      getJson<{ value: string | null }>(
        `/api/settings/${TOKEN_SAVING_THRESHOLD_KEY}`,
      ),
    ]);
    if (isTokenSavingMode(modeData?.value)) result.mode = modeData.value;
    const thresholdNum = Number(thresholdData?.value);
    if (thresholdData?.value && Number.isFinite(thresholdNum)) {
      result.threshold = clampThreshold(thresholdNum);
    }
  } catch {
    // Best-effort: fall back to localStorage defaults.
  }
  return result;
}

export function tokenSavingModeLabel(mode: TokenSavingMode): string {
  switch (mode) {
    case "off":
      return "オフ";
    case "suggest":
      return "提案";
    case "auto":
      return "自動";
  }
}