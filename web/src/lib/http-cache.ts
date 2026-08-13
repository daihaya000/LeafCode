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
export function withReadCache(
  res: NextResponse,
  opts?: { maxAge?: number; staleWhileRevalidate?: number },
): NextResponse {
  const maxAge = opts?.maxAge ?? 30;
  const swr = opts?.staleWhileRevalidate ?? 600;
  res.headers.set(
    "Cache-Control",
    `private, max-age=${maxAge}, stale-while-revalidate=${swr}`,
  );
  return res;
}
