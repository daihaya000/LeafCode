"use client";

/** Client-side fetch helpers (browser → BFF). */

import { assertSafeOpenCodePath } from "./opencode-id";
import { directoryHeaders } from "./directory-header";

/** Default abort for hung BFF/engine calls that omit an explicit timeout. */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

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

function withTimeoutSignal(timeoutMs: number | undefined): {
  signal?: AbortSignal;
  clear: () => void;
} {
  const ms =
    typeof timeoutMs === "number" && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
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
  const { timeoutMs, signal: _ignored, ...rest } = init ?? {};
  void _ignored;
  const { signal, clear } = withTimeoutSignal(timeoutMs);
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

export async function getJson<T>(
  path: string,
  params?: Record<string, string | undefined>,
  init?: { timeoutMs?: number },
): Promise<T> {
  const { signal, clear } = withTimeoutSignal(init?.timeoutMs);
  try {
    const res = await fetch(apiUrl(path, params), { cache: "no-store", signal });
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
    return data as T;
  } catch (err) {
    asTimeoutError(path, err, signal?.aborted === true);
  } finally {
    clear();
  }
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
