import type { NextResponse } from "next/server";

/**
 * Cache-Control for read-only BFF GET endpoints.
 *
 * These endpoints only serve data the browser already tolerates serving
 * stale-while-revalidate (the client also caches them in stale-cache.ts),
 * so the HTTP contract is explicitly declared here:
 *   - private: per-user local data, never shareable
 *   - max-age: safe reuse window for the browser's HTTP cache
 *   - stale-while-revalidate: serve stale for `swr` seconds while refreshing
 *
 * The client fetches these with `cache: "no-cache"` so the browser
 * revalidates via ETag (Next.js emits one automatically) after every write,
 * which keeps the HTTP cache consistent with sendJson invalidation.
 */

/**
 * Default freshness in SECONDS (the Cache-Control unit). Single source of
 * truth for the standard reuse window (30s fresh / 600s stale); the client
 * cache (stale-cache.ts) derives its millisecond values from these
 * (REFACTORING_PLAN P4-c / IMPROVEMENT 9-1).
 */
export const DEFAULT_MAX_AGE_SECONDS = 30;
export const DEFAULT_SWR_SECONDS = 600;

export function withReadCache(
  res: NextResponse,
  opts?: { maxAge?: number; staleWhileRevalidate?: number },
): NextResponse {
  const maxAge = opts?.maxAge ?? DEFAULT_MAX_AGE_SECONDS;
  const swr = opts?.staleWhileRevalidate ?? DEFAULT_SWR_SECONDS;
  res.headers.set(
    "Cache-Control",
    `private, max-age=${maxAge}, stale-while-revalidate=${swr}`,
  );
  return res;
}
