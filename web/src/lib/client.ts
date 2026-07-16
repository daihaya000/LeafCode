"use client";

/** Client-side fetch helpers (browser → BFF). */

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

export async function getJson<T>(
  path: string,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const res = await fetch(apiUrl(path, params), { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      (body as { error?: string }).error ?? `${path} failed: ${res.status}`,
      res.status,
    );
  }
  return body as T;
}

export async function sendJson<T>(
  method: "POST" | "PATCH" | "DELETE" | "PUT",
  path: string,
  body?: unknown,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const res = await fetch(apiUrl(path, params), {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      (data as { error?: string }).error ?? `${path} failed: ${res.status}`,
      res.status,
    );
  }
  return data as T;
}

/** Browser → BFF → OpenCode proxy call with the workspace directory attached. */
export async function ocJson<T>(
  path: string,
  directory: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(apiUrl(`/api/opencode${path}`, { directory }), {
    method: init?.method ?? "GET",
    headers: {
      "x-opencode-directory": directory,
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (data as { error?: string } | null)?.error ?? `${path} failed: ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}
