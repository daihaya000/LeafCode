import {
  isBlockedOpencodeWrite,
  resolveOpencodeBaseUrl,
} from "./opencode";
import { resolvedOpenCodePathname } from "./opencode-id";
import { directoryHeaders, withDirectoryQuery } from "./directory-header";

export class OcError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * OpenCode REST wraps list responses as `{ data: T[] }` (v2 generation) while
 * older generations return a bare array. Single unwrap for every list-returning
 * ocServer call (IMPROVEMENT 3-3): anything that is not an array or a
 * `{ data: array }` wrapper yields `[]`, so consumers never branch on the
 * generation shape.
 */
export function unwrapOcData<T>(pending: unknown): T[] {
  if (Array.isArray(pending)) return pending as T[];
  if (
    pending &&
    typeof pending === "object" &&
    Array.isArray((pending as { data?: unknown }).data)
  ) {
    return (pending as { data: T[] }).data;
  }
  return [];
}

/** Server-side (BFF → OpenCode) JSON call with directory context + timeout. */
export async function ocServer<T>(
  directory: string | null,
  path: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<T> {
  const baseUrl = await resolveOpencodeBaseUrl();
  let resolved: string;
  try {
    resolved = resolvedOpenCodePathname(path, baseUrl);
  } catch (err) {
    throw new OcError(
      err instanceof Error ? err.message : "invalid OpenCode path",
      400,
    );
  }
  const method = init?.method ?? "GET";
  if (
    isBlockedOpencodeWrite(method, path) ||
    isBlockedOpencodeWrite(method, resolved)
  ) {
    throw new OcError(
      "OpenCode config/auth/mcp writes are disabled in LeafCode",
      403,
    );
  }

  const headers: Record<string, string> = {
    ...directoryHeaders(directory),
  };
  if (init?.body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  try {
    const url = withDirectoryQuery(new URL(path, baseUrl), directory);
    res = await fetch(url, {
      method,
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(init?.timeoutMs ?? 10_000),
    });
  } catch (err) {
    // `AbortSignal.timeout` rejects with a DOMException whose raw message is
    // "The operation was aborted due to timeout" — unhelpful when surfaced to
    // the caller (e.g. the goal loop writes it verbatim into the `error`
    // column). Convert it to a clear 408 with the actual duration, mirroring
    // the BFF proxy in route.ts.
    if (err instanceof DOMException && err.name === "TimeoutError") {
      const seconds = Math.round((init?.timeoutMs ?? 10_000) / 1000);
      throw new OcError(
        `OpenCode engine が${seconds}秒でタイムアウトしました (${path})`,
        408,
      );
    }
    throw new OcError(
      err instanceof Error ? err.message : "OpenCode engine unreachable",
      503,
    );
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg =
      (data as { error?: string; message?: string } | null)?.error ??
      (data as { message?: string } | null)?.message ??
      `OpenCode ${path} failed: ${res.status}`;
    throw new OcError(msg, res.status);
  }
  return data as T;
}
