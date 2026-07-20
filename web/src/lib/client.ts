"use client";

/** Client-side fetch helpers (browser → BFF). */

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

export async function getJson<T>(
  path: string,
  params?: Record<string, string | undefined>,
  init?: { timeoutMs?: number },
): Promise<T> {
  const { signal, clear } = withTimeoutSignal(init?.timeoutMs);
  try {
    const res = await fetch(apiUrl(path, params), { cache: "no-store", signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(
        (body as { error?: string }).error ?? `${path} failed: ${res.status}`,
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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(
        (data as { error?: string }).error ?? `${path} failed: ${res.status}`,
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
  const { signal, clear } = withTimeoutSignal(init?.timeoutMs);
  try {
    const res = await fetch(apiUrl(`/api/opencode${path}`, { directory }), {
      method: init?.method ?? "GET",
      headers: {
        "x-opencode-directory": directory,
        ...(init?.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal,
    });
    const data = await res.json().catch(() => null);
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
