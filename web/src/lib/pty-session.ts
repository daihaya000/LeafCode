/**
 * PTY session helpers — direct Engine calls bypassing the generic proxy.
 *
 * The generic proxy (`api/opencode/[...path]/route.ts` + `ocServer()`) runs
 * every request through `isBlockedOpencodeWrite()`, which intentionally blocks
 * PTY create/update/delete/connect-token as "remote shell equivalent"
 * (arbitrary command execution). This module talks to the Engine PTY API
 * directly so the block stays in place for the generic path, while a narrow
 * host-only BFF route (`api/pty-session/**`) can proxy these calls safely.
 *
 * See `docs/specs/pty-interactive-terminal.md` for the design rationale.
 */
import fs from "node:fs";
import path from "node:path";
import { OPENCODE_BASE_URL } from "./opencode";
import { directoryHeaders, withDirectoryQuery } from "./directory-header";

/** Engine `Pty` schema (opencode-schema.d.ts components["schemas"]["Pty"]). */
export interface Pty {
  id: string;
  title: string;
  command: string;
  args: string[];
  cwd: string;
  status: "running" | "exited";
  pid: number;
  exitCode?: number;
}

export class PtyError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Resolve `cwd` against the project `directory` and refuse escapes.
 *
 * PTY creation is arbitrary-command-execution equivalent, so the working
 * directory must stay within the request's project `directory` (itself
 * allowlist-validated by the caller). `..` traversal and symlink escapes
 * are rejected using both `path.resolve` and `fs.realpathSync.native`,
 * mirroring `assertAllowedDirectory` in allowlist.ts.
 *
 * Returns the resolved cwd to forward to the Engine, or the project
 * directory itself when `cwd` is omitted.
 */
export function resolveScopedCwd(
  directory: string,
  cwd?: string,
): { ok: true; cwd: string } | { ok: false; status: number; error: string } {
  if (!directory || typeof directory !== "string" || !directory.trim()) {
    return { ok: false, status: 400, error: "directory is required" };
  }
  const base = path.resolve(directory);
  // path.resolve("") yields process.cwd(); guard against an empty resolved
  // base so we never scope against the BFF's working directory by accident.
  if (!base) {
    return { ok: false, status: 400, error: "directory is required" };
  }

  const requested = cwd && typeof cwd === "string" && cwd.trim() ? cwd : base;
  const resolved = path.resolve(base, requested);

  // Reject explicit `..` traversal before touching the filesystem.
  const rel = path.relative(base, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return {
      ok: false,
      status: 403,
      error: "cwd escapes the project directory",
    };
  }

  // Symlink escape: realpath must also stay under base.
  let real = resolved;
  try {
    real = fs.realpathSync.native(resolved);
  } catch {
    // Path may not exist yet; rely on the resolved-form check above.
  }
  const realRel = path.relative(base, real);
  if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
    return {
      ok: false,
      status: 403,
      error: "cwd escapes the project directory (symlink)",
    };
  }

  return { ok: true, cwd: resolved };
}

/** Build the Engine URL for a PTY path, attaching the directory context. */
function engineUrl(ptyPath: string, directory: string | null): URL {
  return withDirectoryQuery(
    new URL(ptyPath, OPENCODE_BASE_URL),
    directory,
  );
}

/** Fetch helper for Engine PTY calls (does NOT go through isBlockedOpencodeWrite). */
async function engineFetch<T>(
  ptyPath: string,
  init: {
    method: string;
    directory: string | null;
    body?: unknown;
    timeoutMs?: number;
  },
): Promise<T> {
  const url = engineUrl(ptyPath, init.directory);
  const headers: Record<string, string> = {
    ...directoryHeaders(init.directory),
  };
  if (init.body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      const seconds = Math.round(
        (init.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000,
      );
      throw new PtyError(
        `OpenCode engine が${seconds}秒でタイムアウトしました (${ptyPath})`,
        408,
      );
    }
    throw new PtyError(
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
      `OpenCode ${ptyPath} failed: ${res.status}`;
    throw new PtyError(msg, res.status);
  }
  return data as T;
}

/** Create a PTY session on the Engine (POST /pty). */
export function createPty(
  directory: string,
  body: { cwd: string; title?: string },
): Promise<Pty> {
  // command/args/env are intentionally NOT forwarded: the WebUI must not let
  // a browser pick an arbitrary executable. The Engine uses its default shell.
  const payload: Record<string, unknown> = { cwd: body.cwd };
  if (body.title) payload.title = body.title;
  return engineFetch<Pty>("/pty", {
    method: "POST",
    directory,
    body: payload,
  });
}

/** List PTY sessions on the Engine (GET /pty). */
export function listPtys(directory: string): Promise<Pty[]> {
  return engineFetch<Pty[]>("/pty", { method: "GET", directory });
}

/** Update a PTY session's size on the Engine (PUT /pty/{id}). */
export function resizePty(
  directory: string,
  ptyId: string,
  rows: number,
  cols: number,
): Promise<Pty> {
  return engineFetch<Pty>(`/pty/${encodeURIComponent(ptyId)}`, {
    method: "PUT",
    directory,
    body: { size: { rows, cols } },
  });
}

/** Remove a PTY session on the Engine (DELETE /pty/{id}). */
export function removePty(
  directory: string,
  ptyId: string,
): Promise<boolean> {
  return engineFetch<boolean>(`/pty/${encodeURIComponent(ptyId)}`, {
    method: "DELETE",
    directory,
  });
}

// ---------------------------------------------------------------------------
// Phase B: WebSocket relay (BFF ↔ Engine) + pseudo-bidirectional SSE/POST
// (Browser ↔ BFF). Next.js Route Handlers cannot accept HTTP Upgrade, so the
// browser side uses an SSE output stream + POST input stream, while the BFF
// talks to the Engine over a real WebSocket (Node 22+ global `WebSocket`).
// ---------------------------------------------------------------------------

/** Result of `POST /pty/{id}/connect-token` — a short-lived WS ticket. */
export interface PtyConnectToken {
  ticket: string;
  expires_in: number;
}

/**
 * Issue a short-lived WebSocket connect ticket from the Engine for `ptyId`.
 * Uses the v1 endpoint; the ticket is forwarded to the WS URL by `connectPty`.
 */
export function createConnectToken(
  directory: string,
  ptyId: string,
): Promise<PtyConnectToken> {
  // The v2 token endpoint returns `{ location, data: { ticket, expires_in } }`;
  // normalize both v1 and v2 shapes.
  return engineFetch<unknown>(
    `/pty/${encodeURIComponent(ptyId)}/connect-token`,
    { method: "POST", directory },
  ).then((raw) => {
    const r = raw as Partial<PtyConnectToken> & {
      data?: Partial<PtyConnectToken>;
    };
    const inner = r.data ?? r;
    if (!inner || typeof inner.ticket !== "string") {
      throw new PtyError("engine did not return a connect ticket", 502);
    }
    return {
      ticket: inner.ticket,
      expires_in: typeof inner.expires_in === "number" ? inner.expires_in : 0,
    };
  });
}

/**
 * Build the Engine WebSocket URL for `/pty/{id}/connect`.
 *
 * The v1 connect endpoint declares no query params, so the ticket is passed
 * via the `Sec-WebSocket-Protocol` subprotocol (`ticket.<value>`). The v2
 * endpoint accepts `?ticket=` as a query param. We try v2 first (cleaner),
 * falling back is unnecessary because the Engine accepts both forms here.
 */
function engineWsUrl(
  ptyId: string,
  directory: string,
  ticket: string,
): { url: string; protocols: string[] } {
  const base = new URL(OPENCODE_BASE_URL);
  // http(s) -> ws(s)
  const wsProto = base.protocol === "https:" ? "wss:" : "ws:";
  const ws = new URL(`${wsProto}//${base.host}/api/pty/${encodeURIComponent(ptyId)}/connect`);
  ws.searchParams.set("ticket", ticket);
  ws.searchParams.set("location[directory]", directory);
  return { url: ws.toString(), protocols: [] };
}

/** Open BFF→Engine WebSocket and resolve once open. Rejects on error/timeout. */
export function connectPty(
  directory: string,
  ptyId: string,
): Promise<WebSocket> {
  return createConnectToken(directory, ptyId).then((token) => {
    const { url, protocols } = engineWsUrl(ptyId, directory, token.ticket);
    const ws = new WebSocket(url, protocols);
    return new Promise<WebSocket>((resolve, reject) => {
      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* ignore */ }
        reject(new PtyError("engine WebSocket open timed out", 504));
      }, DEFAULT_TIMEOUT_MS);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(ws);
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new PtyError("engine WebSocket connection failed", 502));
      });
    });
  });
}
