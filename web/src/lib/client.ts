"use client";

/** Client-side fetch helpers (browser → BFF). */

import { assertSafeOpenCodePath } from "./opencode-id";
import { directoryHeaders } from "./directory-header";
import {
  invalidatePrefix,
  policyForPath,
  readCached,
  writeCache,
  type StaleCachePolicy,
} from "./stale-cache";

/** Default abort for hung BFF/engine calls that omit an explicit timeout. */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export {
  IMAGE_ANALYSIS_SEND_TIMEOUT_MS,
  NEW_TASK_SEND_TIMEOUT_MS,
} from "./image-send-timeout";

export function apiUrl(path: string, params?: Record<string, string | undefined>) {
  const u = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) u.searchParams.set(k, v);
  }
  return u.toString();
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function withTimeoutSignal(
  timeoutMs: number | undefined,
  parentSignal?: AbortSignal,
): {
  signal?: AbortSignal;
  clear: () => void;
} {
  const ms =
    typeof timeoutMs === "number" && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  if (parentSignal?.aborted) abortFromParent();
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function asTimeoutError(path: string, err: unknown, timedOut: boolean): never {
  if (
    timedOut ||
    (err instanceof DOMException && err.name === "AbortError")
  ) {
    throw new ApiError(`${path} timed out`, 408);
  }
  throw err;
}

/** Read a response body with the same timeout signal as the fetch. */
async function readBodyWithTimeout<T>(
  reader: () => Promise<T>,
  path: string,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) {
    return reader();
  }
  const bodyPromise = reader().catch((err: unknown) => {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(`${path} timed out`, 408);
    }
    throw err;
  });
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new ApiError(`${path} timed out`, 408));
      return;
    }
    signal.addEventListener(
      "abort",
      () => reject(new ApiError(`${path} timed out`, 408)),
      { once: true },
    );
  });
  return Promise.race([bodyPromise, abortPromise]) as Promise<T>;
}

/**
 * Parse a response body as JSON, treating 204/205 or an empty/whitespace-only
 * body as a safe "no content" success (`undefined`) instead of letting
 * `Response.json()` throw a SyntaxError on empty input.
 */
async function parseJsonBody<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.status === 205) {
    return undefined as T;
  }
  const text = await res.text();
  if (text.trim().length === 0) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

async function readJsonWithTimeout<T>(
  res: Response,
  path: string,
  signal: AbortSignal | undefined,
): Promise<T> {
  return readBodyWithTimeout(() => parseJsonBody<T>(res), path, signal);
}

function keepTimeoutForBody(
  res: Response,
  path: string,
  signal: AbortSignal | undefined,
  clear: () => void,
): Response {
  const response = res as Response & Record<string, unknown>;
  const readers = ["arrayBuffer", "blob", "formData", "json", "text"] as const;
  for (const name of readers) {
    const reader = response[name];
    if (typeof reader !== "function") continue;
    (response as Record<string, unknown>)[name] = () =>
      readBodyWithTimeout(
        () => (reader as () => Promise<unknown>).call(response),
        path,
        signal,
      ).finally(clear);
  }

  // A caller may consume the stream directly instead of using a convenience reader.
  const body = response.body as ReadableStream<Uint8Array> | null | undefined;
  if (body && typeof ReadableStream !== "undefined") {
    try {
      Object.defineProperty(response, "body", {
        configurable: true,
        get: () => {
          const source = body.getReader();
          return new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const result = await readBodyWithTimeout(
                  () => source.read(),
                  path,
                  signal,
                );
                if (result.done) {
                  clear();
                  controller.close();
                } else {
                  controller.enqueue(result.value);
                }
              } catch (err) {
                clear();
                controller.error(err);
                await source.cancel(err);
              }
            },
            async cancel(reason) {
              clear();
              await source.cancel(reason);
            },
          });
        },
      });
    } catch {
      // Some Response implementations expose a non-configurable body property.
    }
  }
  return response;
}

/** fetch with default timeout; use for ad-hoc BFF calls outside getJson/ocJson. */
export async function timedFetch(
  input: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs, signal: parentSignal, ...rest } = init ?? {};
  const { signal, clear } = withTimeoutSignal(
    timeoutMs,
    parentSignal ?? undefined,
  );
  try {
    const res = await fetch(input, {
      cache: "no-store",
      ...rest,
      signal,
    });
    return keepTimeoutForBody(res, input, signal, clear);
  } catch (err) {
    clear();
    asTimeoutError(input, err, signal?.aborted === true);
  }
}

// Share only requests that are currently in flight. This removes duplicate
// boot-time GETs (HomeView, Sidebar and attention providers can all request
// /api/tasks together) without serving stale data after a request settles.
const inFlightJsonRequests = new Map<string, Promise<unknown>>();

// Cached GETs that are stale are re-validated in the background; this set
// prevents two re-validations of the same URL from racing each other.
const revalidatingJsonRequests = new Set<string>();

export function getJson<T>(
  path: string,
  params?: Record<string, string | undefined>,
  init?: { timeoutMs?: number },
): Promise<T> {
  const url = apiUrl(path, params);
  const key = `${url}\0${init?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS}`;
  const existing = inFlightJsonRequests.get(key);
  if (existing) return existing as Promise<T>;

  const policy = policyForPath(new URL(url).pathname);
  if (policy) {
    return getJsonWithCache<T>(path, params, init, url, key, policy);
  }

  const request = getJsonUnshared<T>(path, params, init);
  inFlightJsonRequests.set(key, request);
  const clear = () => {
    if (inFlightJsonRequests.get(key) === request) {
      inFlightJsonRequests.delete(key);
    }
  };
  void request.then(clear, clear);
  return request;
}

function getJsonWithCache<T>(
  path: string,
  params: Record<string, string | undefined> | undefined,
  init: { timeoutMs?: number } | undefined,
  url: string,
  key: string,
  policy: StaleCachePolicy,
): Promise<T> {
  const hit = readCached(url, policy);
  if (hit) {
    if (Date.now() - hit.at >= policy.freshMs && !revalidatingJsonRequests.has(url)) {
      revalidatingJsonRequests.add(url);
      getJsonUnshared<T>(path, params, init, true)
        .then((data) => writeCache(url, data, policy))
        .catch(() => {
          // Keep serving the stale entry; re-validation is best-effort.
        })
        .finally(() => revalidatingJsonRequests.delete(url));
    }
    return Promise.resolve(hit.data as T);
  }

  const request = getJsonUnshared<T>(path, params, init, true).then((data) => {
    writeCache(url, data, policy);
    return data;
  });
  inFlightJsonRequests.set(key, request);
  const clear = () => {
    if (inFlightJsonRequests.get(key) === request) {
      inFlightJsonRequests.delete(key);
    }
  };
  void request.then(clear, clear);
  return request;
}

async function getJsonUnshared<T>(
  path: string,
  params?: Record<string, string | undefined>,
  init?: { timeoutMs?: number },
  httpCache = false,
): Promise<T> {
  const { signal, clear } = withTimeoutSignal(init?.timeoutMs);
  try {
    // Cacheable read endpoints use the HTTP cache with conditional
    // revalidation (ETag) so the browser cache stays consistent with
    // sendJson invalidation; everything else stays no-store.
    const res = await fetch(apiUrl(path, params), {
      cache: httpCache ? "no-cache" : "no-store",
      signal,
    });
    const body = await readJsonWithTimeout(res, path, signal);
    if (!res.ok) {
      throw new ApiError(
        (body as { error?: string } | undefined)?.error ??
          `${path} failed: ${res.status}`,
        res.status,
      );
    }
    return body as T;
  } catch (err) {
    asTimeoutError(path, err, signal?.aborted === true);
  } finally {
    clear();
  }
}

export async function sendJson<T>(
  method: "POST" | "PATCH" | "DELETE" | "PUT",
  path: string,
  body?: unknown,
  params?: Record<string, string | undefined>,
  init?: { timeoutMs?: number },
): Promise<T> {
  const { signal, clear } = withTimeoutSignal(init?.timeoutMs);
  try {
    const res = await fetch(apiUrl(path, params), {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal,
    });
    const data = await readJsonWithTimeout(res, path, signal);
    if (!res.ok) {
      throw new ApiError(
        (data as { error?: string } | undefined)?.error ??
          `${path} failed: ${res.status}`,
        res.status,
      );
    }
    // A successful write invalidates the first two URL segments of every
    // cached GET (e.g. PATCH /api/projects/{id} drops the /api/projects list).
    invalidatePrefix(cacheInvalidationPrefix(path));
    return data as T;
  } catch (err) {
    asTimeoutError(path, err, signal?.aborted === true);
  } finally {
    clear();
  }
}

/** Normalize a write path to the prefix shared with its read endpoints. */
function cacheInvalidationPrefix(path: string): string {
  const match = /^(\/api\/[^/]+)/.exec(path);
  return match ? match[1] : path;
}

/** Browser → BFF → OpenCode proxy call with the workspace directory attached. */
export async function ocJson<T>(
  path: string,
  directory: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<T> {
  try {
    assertSafeOpenCodePath(path);
  } catch {
    throw new ApiError("invalid OpenCode path", 400);
  }
  const { signal, clear } = withTimeoutSignal(init?.timeoutMs);
  try {
    const res = await fetch(apiUrl(`/api/opencode${path}`, { directory }), {
      method: init?.method ?? "GET",
      headers: {
        ...directoryHeaders(directory),
        ...(init?.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal,
    });
    const data = await readJsonWithTimeout(res, path, signal);
    if (!res.ok) {
      const msg =
        (data as { error?: string } | null)?.error ??
        `${path} failed: ${res.status}`;
      throw new ApiError(msg, res.status);
    }
    return data as T;
  } catch (err) {
    asTimeoutError(path, err, signal?.aborted === true);
  } finally {
    clear();
  }
}
