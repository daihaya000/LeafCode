/**
 * Proxy-side caches (REFACTORING_PLAN P4-a): per-directory capability
 * metadata for the provider/agent resolution, the short-TTL GET response
 * cache for the read-only metadata endpoints, and the hop-by-hop header
 * denylist shared by the forwarding paths.
 */

export const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  // fetch() already decompressed the body — forwarding these corrupts responses
  "content-encoding",
  "accept-encoding",
]);

export type ProviderModel = {
  capabilities?: {
    attachment?: boolean;
    input?: { image?: boolean };
  };
};
export type ProviderResponse = {
  all?: { id?: string; models?: Record<string, ProviderModel> }[];
  connected?: string[];
};
export type AgentResponse = {
  name?: string;
  model?: { providerID?: string; modelID?: string };
}[];

// The composer requests these read endpoints before it sends a follow-up.
// Keep only their capability/model metadata so this write proxy can enforce the
// same fail-closed decision without forwarding an unsupported prompt first.
// Cache per directory to avoid cross-project contamination in multi-project setups.
export const cachedProvidersByDir = new Map<string, CapabilityEntry<ProviderResponse>>();
export const cachedAgentsByDir = new Map<string, CapabilityEntry<AgentResponse>>();

/**
 * Bound the per-directory capability caches. They are keyed by directory and
 * only ever SET, so without a cap a long-lived server accumulating many
 * projects would grow without bound and serve stale capabilities forever.
 * Evict the oldest entries first (insertion order) once the cap is exceeded;
 * a subsequent request simply refetches, which also refreshes stale
 * capability data.
 */
export const CAPABILITY_CACHE_MAX = 64;
/** How long a per-directory capability entry stays valid before a refetch. */
export const CAPABILITY_CACHE_TTL_MS = 60_000;

type CapabilityEntry<T> = { at: number; value: T };

export function setBoundedCapabilityCache<T>(
  cache: Map<string, CapabilityEntry<T>>,
  key: string,
  value: T,
): void {
  cache.delete(key);
  cache.set(key, { at: Date.now(), value });
  while (cache.size > CAPABILITY_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== "string") break;
    cache.delete(oldest);
  }
}

// Short-TTL response cache for read-only GET /provider and GET /agent JSON
// replies. The Home composer fires both `/api/opencode/provider` and
// `/api/extensions/provider-models` in the same Promise.all burst, and each
// reaches OpenCode's `/provider` underneath. The provider-models route has
// its own in-process cache; this one collapses the transparent-proxy side so
// the second hit in the same boot burst is an in-memory return. The cache key
// includes the directory (null allowed — Home calls without one) so the
// masked response for one directory never leaks into another. TTL is short
// so a provider reconnect/disconnect surfaces within seconds.
export const GET_RESPONSE_CACHE_TTL_MS = 5_000;
export const GET_RESPONSE_CACHE_MAX = 32;
export type GetResponseCacheEntry = {
  at: number;
  status: number;
  headers: Record<string, string>;
  body: unknown;
};
export const getResponseCache = new Map<string, GetResponseCacheEntry>();

/** Test-only: drop the GET response cache between tests. */
export function __clearGetResponseCacheForTest(): void {
  getResponseCache.clear();
}

export function storeGetResponseCache(
  key: string,
  entry: GetResponseCacheEntry,
): void {
  getResponseCache.set(key, entry);
  while (getResponseCache.size > GET_RESPONSE_CACHE_MAX) {
    const oldest = getResponseCache.keys().next().value;
    if (typeof oldest !== "string") break;
    getResponseCache.delete(oldest);
  }
}

/**
 * Read a capability entry when it is still fresh; expired entries are
 * dropped so the next resolution refetches (provider reconnect/disconnect
 * surfaces within the TTL instead of being served stale forever).
 */
export function readBoundedCapabilityCache<T>(
  cache: Map<string, CapabilityEntry<T>>,
  key: string,
): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at >= CAPABILITY_CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

export function getResponseCacheKey(
  directory: string | null,
  pathname: string,
): string | null {
  // Only cache the two read-only metadata endpoints. Everything else (writes,
  // /config, /session, SSE, ...) is never cached here.
  if (pathname !== "/provider" && pathname !== "/agent") return null;
  return `${directory ?? ""}\0${pathname}`;
}
