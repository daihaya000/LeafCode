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
  EMPTY_AUTO_ROUTE_CONFIG,
  isAutoOptimizeMode,
  isAutoRouteConfigEmpty,
  normalizeAutoRouteConfig,
  type AutoOptimizeMode,
  type AutoRouteConfig,
} from "./auto-model";

const OPTIMIZE_STORAGE_KEY = "webui:auto-optimize";
const SHOW_MODEL_STORAGE_KEY = "webui:auto-show-model";
const ROUTE_OVERRIDES_STORAGE_KEY = "webui:auto-route-overrides";

export const AUTO_OPTIMIZE_EVENT = "webui:auto-optimize";
export const AUTO_SHOW_MODEL_EVENT = "webui:auto-show-model";
export const AUTO_ROUTE_OVERRIDES_EVENT = "webui:auto-route-overrides";

/** Server-side `settings` keys, mirrored in the settings route allowlist. */
export const AUTO_OPTIMIZE_SETTING_KEY = "auto-optimize";
export const AUTO_SHOW_MODEL_SETTING_KEY = "auto-show-model";
export const AUTO_ROUTE_OVERRIDES_SETTING_KEY = "auto-route-overrides";
const autoSettingWriteQueues = new Map<AutoSettingKey, Promise<void>>();

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

/**
 * Per-tier routing config (v2). Stored as JSON in localStorage under the
 * historical `webui:auto-route-overrides` key — v1 (`RouteOverrides`) payloads
 * are migrated by {@link normalizeAutoRouteConfig} on read, so nothing needs
 * a key rename. Corrupted or unknown entries are dropped by the normalizer, so
 * a bad payload always falls back to the preset instead of breaking routing.
 */
export function readAutoRouteConfig(): AutoRouteConfig {
  const raw = readRaw(ROUTE_OVERRIDES_STORAGE_KEY);
  if (!raw) return EMPTY_AUTO_ROUTE_CONFIG;
  try {
    return normalizeAutoRouteConfig(JSON.parse(raw));
  } catch {
    return EMPTY_AUTO_ROUTE_CONFIG;
  }
}

export function writeAutoRouteConfig(config: AutoRouteConfig): void {
  const json = isAutoRouteConfigEmpty(config) ? "" : JSON.stringify(config);
  writeRaw(ROUTE_OVERRIDES_STORAGE_KEY, AUTO_ROUTE_OVERRIDES_EVENT, json);
}

const LOCAL_KEY_BY_SETTING = {
  "auto-optimize": OPTIMIZE_STORAGE_KEY,
  "auto-show-model": SHOW_MODEL_STORAGE_KEY,
  "auto-route-overrides": ROUTE_OVERRIDES_STORAGE_KEY,
} as const;

export type AutoSettingKey =
  | typeof AUTO_OPTIMIZE_SETTING_KEY
  | typeof AUTO_SHOW_MODEL_SETTING_KEY
  | typeof AUTO_ROUTE_OVERRIDES_SETTING_KEY;

const EVENT_BY_SETTING: Record<AutoSettingKey, string> = {
  "auto-optimize": AUTO_OPTIMIZE_EVENT,
  "auto-show-model": AUTO_SHOW_MODEL_EVENT,
  "auto-route-overrides": AUTO_ROUTE_OVERRIDES_EVENT,
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
  routeConfig?: AutoRouteConfig;
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
  const [mode, showModel, routeOverridesRaw] = await Promise.all([
    readServerSetting(AUTO_OPTIMIZE_SETTING_KEY),
    readServerSetting(AUTO_SHOW_MODEL_SETTING_KEY),
    readServerSetting(AUTO_ROUTE_OVERRIDES_SETTING_KEY),
  ]);
  const snapshot: AutoSettingsSnapshot = {};
  if (isAutoOptimizeMode(mode)) snapshot.mode = mode;
  if (showModel !== null) snapshot.showModel = showModel === ON;
  if (routeOverridesRaw) {
    try {
      const config = normalizeAutoRouteConfig(JSON.parse(routeOverridesRaw));
      if (!isAutoRouteConfigEmpty(config)) snapshot.routeConfig = config;
    } catch {
      /* ignore corrupted JSON; preset is used */
    }
  }
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
  const previous = autoSettingWriteQueues.get(key) ?? Promise.resolve();
  const operation = previous.then(async () => {
    try {
      await sendJson("PUT", `/api/settings/${key}`, { value });
    } catch (err) {
      console.warn("writeAutoSettingToServer failed", key, err);
    }
  });
  autoSettingWriteQueues.set(
    key,
    operation.then(
      () => undefined,
      () => undefined,
    ),
  );
  await operation;
}
