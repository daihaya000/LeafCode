/**
 * Client-side stale-while-revalidate cache for read-only BFF GETs.
 *
 * Only paths listed in CACHE_POLICIES are cached (explicit opt-in). Dynamic
 * endpoints (task polling, SSE, git/file/diff, auth, access mode, host state,
 * update checks) stay uncached so live data stays live.
 *
 * A cached hit returns immediately (even when stale) and re-validates in the
 * background, so repeat navigation to Home / Settings / Sidebar renders from
 * memory or localStorage instead of waiting on the server.
 *
 * Persisted entries are only ever read back when the memory entry is missing
 * (fresh page load). Quota failures are ignored - persistence is best-effort.
 */

export type StaleCachePolicy = {
  /** Within this age a cached entry is returned without re-validation. */
  freshMs: number;
  /** Beyond this age the entry is still returned, but re-validated. */
  staleMs: number;
  /** Persist across page loads via localStorage. */
  persist: boolean;
};

type CacheEntry = { data: unknown; at: number };

const STORAGE_PREFIX = "webui.stale-cache.v1.";

const memoryCache = new Map<string, CacheEntry>();

// Prefix matching (first match wins). `exclude` lists more specific prefixes
// that must stay dynamic even though they start with a cached prefix.
const CACHE_POLICIES: Array<{
  prefix: string;
  policy: StaleCachePolicy;
  exclude?: string[];
}> = [
  {
    prefix: "/api/projects",
    policy: { freshMs: 30_000, staleMs: 600_000, persist: true },
  },
  {
    prefix: "/api/tasks/archived",
    policy: { freshMs: 30_000, staleMs: 600_000, persist: true },
  },
  {
    prefix: "/api/workspaces",
    policy: { freshMs: 30_000, staleMs: 600_000, persist: true },
  },
  {
    prefix: "/api/roots",
    policy: { freshMs: 30_000, staleMs: 600_000, persist: true },
  },
  {
    prefix: "/api/analytics/model-ranking",
    policy: { freshMs: 300_000, staleMs: 3_600_000, persist: true },
  },
  {
    prefix: "/api/settings/",
    policy: { freshMs: 30_000, staleMs: 600_000, persist: true },
  },
  {
    prefix: "/api/profiles",
    policy: { freshMs: 30_000, staleMs: 600_000, persist: true },
    exclude: ["/api/profiles/jobs/"],
  },
  {
    prefix: "/api/qwen-native/",
    policy: { freshMs: 60_000, staleMs: 600_000, persist: true },
  },
  {
    prefix: "/api/ollama/status",
    policy: { freshMs: 30_000, staleMs: 300_000, persist: false },
  },
  {
    prefix: "/api/opencode/provider",
    policy: { freshMs: 60_000, staleMs: 1_800_000, persist: true },
  },
  {
    prefix: "/api/extensions/",
    policy: { freshMs: 30_000, staleMs: 600_000, persist: true },
    exclude: ["/api/extensions/agent-files"],
  },
  {
    prefix: "/api/auth/config",
    policy: { freshMs: 30_000, staleMs: 300_000, persist: false },
  },
  {
    prefix: "/api/auth/users",
    policy: { freshMs: 30_000, staleMs: 300_000, persist: true },
  },
  {
    prefix: "/api/health",
    policy: { freshMs: 10_000, staleMs: 60_000, persist: false },
  },
];

/** Resolve the cache policy for a URL pathname, or undefined to skip caching. */
export function policyForPath(pathname: string): StaleCachePolicy | undefined {
  for (const { prefix, policy, exclude } of CACHE_POLICIES) {
    if (!pathname.startsWith(prefix)) continue;
    if (exclude?.some((ex) => pathname.startsWith(ex))) return undefined;
    return policy;
  }
  return undefined;
}

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function loadPersisted(key: string): CacheEntry | undefined {
  if (!storageAvailable()) return undefined;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as CacheEntry;
    if (typeof entry.at !== "number" || entry.data === undefined) {
      return undefined;
    }
    return entry;
  } catch {
    return undefined;
  }
}

function storePersisted(key: string, entry: CacheEntry): void {
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota exceeded / private mode: persistence is best-effort.
  }
}

/** Read a cached entry (memory first, then localStorage), if still fresh-ish. */
export function readCached(key: string, policy: StaleCachePolicy): CacheEntry | undefined {
  const now = Date.now();
  const entry = memoryCache.get(key);
  if (entry) {
    if (now - entry.at <= policy.staleMs) return entry;
    memoryCache.delete(key);
    return undefined;
  }
  const persisted = loadPersisted(key);
  if (!persisted) return undefined;
  if (now - persisted.at > policy.staleMs) {
    removePersisted(key);
    return undefined;
  }
  memoryCache.set(key, persisted);
  return persisted;
}

/** Write (or refresh) a cached entry. */
export function writeCache(key: string, data: unknown, policy: StaleCachePolicy): void {
  if (data === undefined) return;
  const entry: CacheEntry = { data, at: Date.now() };
  memoryCache.set(key, entry);
  if (policy.persist) storePersisted(key, entry);
}

function removePersisted(key: string): void {
  if (!storageAvailable()) return;
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Ignore.
  }
}

function removePersistedByPrefix(prefix: string): void {
  if (!storageAvailable()) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const storageKey = localStorage.key(i);
      if (!storageKey || !storageKey.startsWith(STORAGE_PREFIX)) continue;
      if (keyMatchesPrefix(storageKey.slice(STORAGE_PREFIX.length), prefix)) {
        doomed.push(storageKey);
      }
    }
    for (const storageKey of doomed) localStorage.removeItem(storageKey);
  } catch {
    // Ignore.
  }
}

/** Cache keys are absolute URLs; match invalidation prefixes against their path. */
function keyMatchesPrefix(key: string, prefix: string): boolean {
  try {
    return new URL(key).pathname.startsWith(prefix);
  } catch {
    return key.startsWith(prefix);
  }
}

/**
 * Drop every cached entry whose URL path starts with `prefix` (e.g. the first
 * two segments of a URL, so a PATCH to /api/projects/{id} invalidates the
 * /api/projects list). Called by sendJson after successful writes.
 */
export function invalidatePrefix(prefix: string): void {
  if (!prefix || prefix === "/") return;
  for (const key of [...memoryCache.keys()]) {
    if (keyMatchesPrefix(key, prefix)) memoryCache.delete(key);
  }
  removePersistedByPrefix(prefix);
}

/** Test-only: drop every in-memory and persisted entry. */
export function resetStaleCacheForTests(): void {
  memoryCache.clear();
  if (!storageAvailable()) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const storageKey = localStorage.key(i);
      if (storageKey?.startsWith(STORAGE_PREFIX)) doomed.push(storageKey);
    }
    for (const storageKey of doomed) localStorage.removeItem(storageKey);
  } catch {
    // Ignore.
  }
}
