"use client";

/**
 * Per-plugin enable/disable preferences, persisted in localStorage and
 * broadcast via a custom event so the host + settings stay in sync.
 * Modeled on `lib/access-mode.ts`.
 */

export type PluginPrefs = Record<string, boolean>;

const STORAGE_KEY = "webui:plugins";
export const PLUGINS_CHANGED_EVENT = "webui:plugins";

/** Pure: is a plugin enabled given prefs + its default? */
export function isEnabled(
  prefs: PluginPrefs,
  id: string,
  defaultEnabled: boolean,
): boolean {
  return Object.prototype.hasOwnProperty.call(prefs, id)
    ? prefs[id]
    : defaultEnabled;
}

/** Pure: keep only boolean entries from an untrusted parsed value. */
export function sanitizePrefs(raw: unknown): PluginPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: PluginPrefs = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

export function readPluginPrefs(): PluginPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return sanitizePrefs(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writePluginEnabled(id: string, enabled: boolean): void {
  try {
    const prefs = readPluginPrefs();
    prefs[id] = enabled;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(
      new CustomEvent<PluginPrefs>(PLUGINS_CHANGED_EVENT, { detail: prefs }),
    );
  } catch {
    /* ignore */
  }
}
