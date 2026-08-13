/**
 * Browser-side stale-while-revalidate cache for the provider catalogue
 * (`/api/extensions/provider-models`). The BFF can take seconds to answer
 * when the OpenCode engine is cold or busy, and both HomeView and TaskView
 * gate their model/effort selectors on that response. The cache lets the
 * composers paint the last-known catalogue instantly on mount; the regular
 * fetch that follows immediately replaces it with fresh data.
 */

import type { ProviderModelsDto } from "./extensions";

const STORAGE_KEY = "webui:provider-models-cache";
/** Old catalogue is still usable as an instant paint; the fetch that always
 *  follows corrects any drift. Older entries are dropped as cold start. */
export const PROVIDER_MODELS_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

type CacheEntry = { at: number; providers: ProviderModelsDto[] };

function isProviderModelsDtoList(value: unknown): value is ProviderModelsDto[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (p) =>
      !!p &&
      typeof p === "object" &&
      typeof (p as ProviderModelsDto).id === "string" &&
      Array.isArray((p as ProviderModelsDto).models),
  );
}

/**
 * Last known provider catalogue, or null when absent, malformed, or older
 * than {@link PROVIDER_MODELS_CACHE_MAX_AGE_MS}. Non-fatal: callers keep the
 * loading state when the cache misses.
 */
export function readProviderModelsCache(): ProviderModelsDto[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CacheEntry>;
    if (
      typeof parsed.at !== "number" ||
      Date.now() - parsed.at > PROVIDER_MODELS_CACHE_MAX_AGE_MS
    ) {
      return null;
    }
    return isProviderModelsDtoList(parsed.providers) ? parsed.providers : null;
  } catch {
    return null;
  }
}

/** Persist the fresh catalogue for the next mount. Empty lists are not
 *  cached — a transient empty engine reply must not blank future composers. */
export function writeProviderModelsCache(providers: ProviderModelsDto[]): void {
  if (typeof window === "undefined" || providers.length === 0) return;
  try {
    const entry: CacheEntry = { at: Date.now(), providers };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    /* quota / private mode — the cache is an optimization only */
  }
}

/** Drop the cached catalogue (e.g. after a settings-side mutation). */
export function clearProviderModelsCache(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
