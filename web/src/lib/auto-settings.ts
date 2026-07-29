/**
 * Auto mode settings: the "Optimize For" policy and whether the resolved
 * model name is surfaced.
 *
 * Same two-layer scheme as `default-model.ts`: localStorage is the source of
 * truth for synchronous reads (instant hydration, no request on first paint),
 * the server `settings` table is the durable backup shared across browsers.
 * Every read falls back to the documented default, so a missing, corrupted, or
 * unavailable value never blocks the composer.
 */

import { getJson, sendJson } from "./client";
import {
  DEFAULT_AUTO_OPTIMIZE_MODE,
  isAutoOptimizeMode,
  type AutoOptimizeMode,
} from "./auto-model";

const OPTIMIZE_STORAGE_KEY = "webui:auto-optimize";
const SHOW_MODEL_STORAGE_KEY = "webui:auto-show-model";

export const AUTO_OPTIMIZE_EVENT = "webui:auto-optimize";
export const AUTO_SHOW_MODEL_EVENT = "webui:auto-show-model";

/** Server-side `settings` keys, mirrored in the settings route allowlist. */
export const AUTO_OPTIMIZE_SETTING_KEY = "auto-optimize";
export const AUTO_SHOW_MODEL_SETTING_KEY = "auto-show-model";

/** Stored form of the boolean toggles: `"1"` on, `""` (or absent) off. */
const ON = "1";

function readRaw(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function writeRaw(key: string, event: string, value: string): void {
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
    window.dispatchEvent(new CustomEvent(event, { detail: value }));
  } catch {
    /* ignore */
  }
}

/** Optimize mode, defaulting to `cost` when unset or invalid. */
export function readAutoOptimizeMode(): AutoOptimizeMode {
  const raw = readRaw(OPTIMIZE_STORAGE_KEY);
  return isAutoOptimizeMode(raw) ? raw : DEFAULT_AUTO_OPTIMIZE_MODE;
}

export function writeAutoOptimizeMode(mode: AutoOptimizeMode): void {
  writeRaw(OPTIMIZE_STORAGE_KEY, AUTO_OPTIMIZE_EVENT, mode);
}

/**
 * Whether to surface the model Auto picked. Off by default, mirroring Cursor:
 * the point of Auto is to be judged on results, not on model names.
 */
export function readAutoShowModel(): boolean {
  return readRaw(SHOW_MODEL_STORAGE_KEY) === ON;
}

export function writeAutoShowModel(enabled: boolean): void {
  writeRaw(SHOW_MODEL_STORAGE_KEY, AUTO_SHOW_MODEL_EVENT, enabled ? ON : "");
}

const LOCAL_KEY_BY_SETTING = {
  "auto-optimize": OPTIMIZE_STORAGE_KEY,
  "auto-show-model": SHOW_MODEL_STORAGE_KEY,
} as const;

export type AutoSettingKey =
  | typeof AUTO_OPTIMIZE_SETTING_KEY
  | typeof AUTO_SHOW_MODEL_SETTING_KEY;

const EVENT_BY_SETTING: Record<AutoSettingKey, string> = {
  "auto-optimize": AUTO_OPTIMIZE_EVENT,
  "auto-show-model": AUTO_SHOW_MODEL_EVENT,
};

/**
 * Subscribe to same-document writes and cross-tab localStorage changes.
 * The native `storage` event is not fired in the document that performed the
 * write, so it complements rather than duplicates the CustomEvent path.
 */
export function subscribeAutoSetting(
  key: AutoSettingKey,
  listener: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const eventName = EVENT_BY_SETTING[key];
  const storageKey = LOCAL_KEY_BY_SETTING[key];
  const onStorage = (event: StorageEvent) => {
    // `key === null` means another tab called localStorage.clear().
    if (event.key === storageKey || event.key === null) listener();
  };
  window.addEventListener(eventName, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(eventName, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export type AutoSettingsSnapshot = {
  mode?: AutoOptimizeMode;
  showModel?: boolean;
};

/**
 * Whether this browser already has a local choice for `key`. Callers use it to
 * restore a server value only when it would not clobber a local decision.
 */
export function hasStoredAutoSetting(key: AutoSettingKey): boolean {
  return readRaw(LOCAL_KEY_BY_SETTING[key]) !== null;
}

async function readServerSetting(key: AutoSettingKey): Promise<string | null> {
  try {
    const data = await getJson<{ value: string | null }>(
      `/api/settings/${key}`,
    );
    const value = data?.value;
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Read the durable copies from the server `settings` table. Keys that are
 * unset (or whose request failed) are omitted so callers can distinguish
 * "not configured" from "configured off" and only patch what they must.
 */
export async function readAutoSettingsFromServer(): Promise<AutoSettingsSnapshot> {
  if (typeof window === "undefined") return {};
  const [mode, showModel] = await Promise.all([
    readServerSetting(AUTO_OPTIMIZE_SETTING_KEY),
    readServerSetting(AUTO_SHOW_MODEL_SETTING_KEY),
  ]);
  const snapshot: AutoSettingsSnapshot = {};
  if (isAutoOptimizeMode(mode)) snapshot.mode = mode;
  if (showModel !== null) snapshot.showModel = showModel === ON;
  return snapshot;
}

/**
 * Mirror one setting to the server. Non-fatal: localStorage has already been
 * updated synchronously, so a failure only means it won't sync elsewhere.
 */
export async function writeAutoSettingToServer(
  key: AutoSettingKey,
  value: string,
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await sendJson("PUT", `/api/settings/${key}`, { value });
  } catch (err) {
    console.warn("writeAutoSettingToServer failed", key, err);
  }
}
