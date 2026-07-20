import { OPENCODE_BASE_URL } from "./opencode";
import { assertSafeOpenCodePath } from "./opencode-id";

export class OcError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Server-side (BFF → OpenCode) JSON call with directory context + timeout. */
export async function ocServer<T>(
  directory: string | null,
  path: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<T> {
  try {
    assertSafeOpenCodePath(path);
  } catch (err) {
    throw new OcError(
      err instanceof Error ? err.message : "invalid OpenCode path",
      400,
    );
  }

  const headers: Record<string, string> = {};
  if (directory) headers["x-opencode-directory"] = directory;
  if (init?.body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(new URL(path, OPENCODE_BASE_URL), {
      method: init?.method ?? "GET",
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(init?.timeoutMs ?? 10_000),
    });
  } catch (err) {
    throw new OcError(
      err instanceof Error ? err.message : "OpenCode engine unavailable",
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
