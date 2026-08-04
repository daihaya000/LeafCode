"use client";

/**
 * Per-addon enable/disable preferences, persisted in localStorage and
 * broadcast via a custom event so the host + settings stay in sync.
 * Modeled on `lib/access-mode.ts`.
 *
 * Migrates legacy `webui:plugins` keys once so existing prefs are kept.
 */

export type AddonPrefs = Record<string, boolean>;

const STORAGE_KEY = "webui:addons";
const LEGACY_STORAGE_KEY = "webui:plugins";
export const ADDONS_CHANGED_EVENT = "webui:addons";

/** Pure: is an addon enabled given prefs + its default? */
export function isEnabled(
  prefs: AddonPrefs,
  id: string,
  defaultEnabled: boolean,
): boolean {
  return Object.prototype.hasOwnProperty.call(prefs, id)
    ? prefs[id]
    : defaultEnabled;
}

/** Pure: keep only boolean entries from an untrusted parsed value. */
export function sanitizePrefs(raw: unknown): AddonPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: AddonPrefs = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

function migrateLegacyPrefs(): AddonPrefs | null {
  try {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return null;
    const prefs = sanitizePrefs(JSON.parse(legacy));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return prefs;
  } catch {
    return null;
  }
}

export function readAddonPrefs(): AddonPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizePrefs(JSON.parse(raw));
    return migrateLegacyPrefs() ?? {};
  } catch {
    return {};
  }
}

/**
 * Serializes read-modify-write access to `STORAGE_KEY` within this tab.
 * Without it, two near-simultaneous `writeAddonEnabled` calls (e.g. toggling
 * two addons in quick succession) can both read the same pre-update prefs
 * and the second `setItem` silently drops the first call's change.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

export function writeAddonEnabled(id: string, enabled: boolean): void {
  writeQueue = writeQueue.then(() => {
    try {
      const prefs = readAddonPrefs();
      prefs[id] = enabled;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      window.dispatchEvent(
        new CustomEvent<AddonPrefs>(ADDONS_CHANGED_EVENT, { detail: prefs }),
      );
    } catch {
      /* ignore */
    }
  });
}
