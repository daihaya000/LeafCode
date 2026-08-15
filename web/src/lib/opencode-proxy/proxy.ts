import {
  NextRequest,
  NextResponse,
} from "next/server";
import {
  assertAllowedDirectory,
} from "@/lib/allowlist";
import {
  markCollaborationSnapshotCompacted,
  findWorkspaceIdsBySession,
  releaseSessionCompactionLock,
  tryAcquireSessionCompactionLock,
} from "@/lib/db";
import {
  releaseMemoryInjectionClaim,
  type MemoryInjectionClaim,
} from "@/lib/memory";
import {
  directoryHeaders,
  withDirectoryQuery,
} from "@/lib/directory-header";
import {
  pauseGoalLoopForManualSend,
} from "@/lib/goal-loop";
import {
  GET_RESPONSE_CACHE_TTL_MS,
  HOP_BY_HOP,
  getResponseCache,
  getResponseCacheKey,
  storeGetResponseCache,
} from "@/lib/opencode-proxy/cache";
import {
  containsImagePart,
  imagePartsWithinLimits,
} from "@/lib/opencode-proxy/image";
import {
  armHangWatch,
  disarmHangWatch,
} from "@/lib/hang-watchdog";
import {
  isIntelligenceVariant,
} from "@/lib/model-variants";
import {
  isQwenNativeVisionAvailable,
  rewriteNativeRequest,
} from "@/lib/qwen-native-vision";
import {
  OPENCODE_BASE_URL,
  isBlockedOpencodeWrite,
  maskSecrets,
} from "@/lib/opencode";
import {
  resolvedOpenCodePathname,
} from "@/lib/opencode-id";
import {
  SSE_HEARTBEAT_MS,
  SSE_UPSTREAM_CONNECT_TIMEOUT_MS,
  encodeSseHeartbeat,
} from "@/lib/sse-health";
import {
  requireAuthorized,
} from "@/lib/api-guard";
import {
  injectCollaborationContext,
  injectWorkspaceMemory,
} from "@/lib/opencode-proxy/inject";
import {
  cacheCapabilityMetadata,
  supportsImageInput,
} from "@/lib/opencode-proxy/model";
import {
  abortedSessionId,
  bodyHasPermissionField,
  compactLockConflict,
  compactSessionId,
  hangWatchSessionId,
  isImageGuardedWrite,
  isLongRunningSyncMutation,
  isSessionPermissionWrite,
  manualSendSessionId,
} from "@/lib/opencode-proxy/session";
import {
  isV2PromptPath,
  maybeUnwrapV2Data,
  v1PromptBodyToV2,
} from "@/lib/opencode-proxy/v2";

/**
 * A prompt/command written straight into a session. Any of these is a "manual
 * send" from the goal loop's point of view and must pause a live loop first.
 *
 * The loop's own prompts never reach this proxy: `goal-loop.ts` calls the engine
 * through `ocServer` directly, so this hook cannot pause the loop against
 * itself. See docs/specs/goal-loop.md invariant I9.
 */


/** Upstream JSON/proxy timeout; SSE paths omit this so streams stay open. */
const UPSTREAM_TIMEOUT_MS = 90_000;

/**
 * Synchronous mutations (session.command / session.prompt) block until the
 * engine finishes running the command. Keep this below the route's
 * `maxDuration` while allowing legitimate five-minute commands to finish.
 */
const LONG_RUNNING_UPSTREAM_TIMEOUT_MS = 290_000;

export async function proxy(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  // This is a catch-all proxy to the OpenCode server, so an unguarded call lets
  // anyone create a session and run agent commands on the host. Guard first,
  // before any request parsing.
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { path: segments } = await context.params;
  const pathname = "/" + (segments?.join("/") ?? "");

  let resolvedPathname: string;
  try {
    resolvedPathname = resolvedOpenCodePathname(pathname, OPENCODE_BASE_URL);
  } catch {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  if (
    isBlockedOpencodeWrite(req.method, pathname) ||
    isBlockedOpencodeWrite(req.method, resolvedPathname)
  ) {
    return NextResponse.json(
      { error: "OpenCode config/auth/mcp writes are disabled in LeafCode" },
      { status: 403 },
    );
  }

  const incoming = new URL(req.url);
  const rawDirectory =
    req.headers.get("x-opencode-directory") ??
    incoming.searchParams.get("directory");

  // Global health/event endpoints do not require directory
  const needsDirectory =
    !pathname.startsWith("/global/") &&
    pathname !== "/doc" &&
    pathname !== "/";

  // Prefer the allowlist-resolved path for everything we forward upstream so a
  // relative client value (e.g. ".") cannot resolve differently in OpenCode.
  let directory: string | null = null;

  if (needsDirectory && rawDirectory) {
    const check = assertAllowedDirectory(rawDirectory);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }
    directory = check.path;
  } else if (needsDirectory && !rawDirectory) {
    // OpenCode may still accept some calls; we require directory for safety
    // except for listing providers etc. — allow without directory for GET /provider,/config
    const allowWithoutDir =
      req.method === "GET" &&
      (pathname === "/config" ||
        pathname === "/config/providers" ||
        pathname.startsWith("/provider") ||
        pathname.startsWith("/api/provider") ||
        pathname.startsWith("/mcp") ||
        pathname.startsWith("/api/mcp") ||
        pathname === "/path" ||
        pathname === "/agent" ||
        pathname === "/command" ||
        pathname === "/skill");
    // /event requires directory + allowlist (useSessionStream always sends it).
    // /global/event is under /global/ and skips needsDirectory intentionally.
    if (!allowWithoutDir) {
      return NextResponse.json(
        { error: "x-opencode-directory (or ?directory=) is required" },
        { status: 400 },
      );
    }
  } else if (rawDirectory) {
    // Optional directory on global endpoints: still bind to the allowlist path.
    const check = assertAllowedDirectory(rawDirectory);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }
    directory = check.path;
  }

  const target = new URL(pathname + incoming.search, OPENCODE_BASE_URL);
  // Defense in depth: always set the validated `?directory=` on the upstream
  // URL so a mismatched header/query pair cannot smuggle an unvalidated path
  // through to OpenCode. The query is safe for non-Latin-1 paths
  // (URLSearchParams percent-encodes), while the header below is omitted for
  // unsafe values.
  if (directory) {
    withDirectoryQuery(target, directory);
  }

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    // Drop the client directory header; we re-attach the validated path below.
    if (key.toLowerCase() === "x-opencode-directory") return;
    headers.set(key, value);
  });
  for (const [key, value] of Object.entries(directoryHeaders(directory))) {
    headers.set(key, value);
  }

  const wantsSse =
    pathname === "/event" ||
    pathname === "/global/event" ||
    pathname === "/api/event" ||
    /^\/api\/session\/[^/]+\/event$/.test(pathname);

  let requestBody: ArrayBuffer | undefined;
  let upstream: Response;
  let memoryClaim: MemoryInjectionClaim | null = null;
  let compactionLock: { sessionId: string; ownerId: string } | null = null;
  /** Session whose hang watch this request armed, so a rejected send can undo it. */
  let armedWatchSessionId: string | null = null;
  /**
   * Bounds only the wait for upstream SSE response headers; cleared the moment
   * they arrive so an established stream is never timed out.
   */
  let sseConnectTimer: ReturnType<typeof setTimeout> | null = null;
  let sseConnectTimedOut = false;
  const clearSseConnectTimer = () => {
    if (sseConnectTimer) {
      clearTimeout(sseConnectTimer);
      sseConnectTimer = null;
    }
  };
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      requestBody = await req.arrayBuffer();
      if (
        isSessionPermissionWrite(req.method, pathname) ||
        isSessionPermissionWrite(req.method, resolvedPathname)
      ) {
        try {
          const body = JSON.parse(new TextDecoder().decode(requestBody)) as unknown;
          if (bodyHasPermissionField(body)) {
            return NextResponse.json(
              {
                error:
                  "session permission writes are disabled; use /api/subagent-permission",
              },
              { status: 403 },
            );
          }
        } catch {
          // Preserve the existing behavior for non-JSON or malformed bodies.
        }
      }
      if (req.method === "POST" && isImageGuardedWrite(pathname)) {
        try {
          let body = JSON.parse(new TextDecoder().decode(requestBody)) as unknown;
          const variant =
            body && typeof body === "object" && !Array.isArray(body)
              ? (body as { variant?: unknown }).variant
              : undefined;
          if (
            /^(?:\/api)?\/session\/[^/]+\/prompt_async$/.test(pathname) &&
            variant !== undefined &&
            variant !== null &&
            variant !== "" &&
            !(typeof variant === "string" && isIntelligenceVariant(variant))
          ) {
            return NextResponse.json({ error: "invalid variant" }, { status: 400 });
          }
          if (containsImagePart(body)) {
            if (!imagePartsWithinLimits(body)) {
              return NextResponse.json(
                { error: "invalid files" },
                { status: 400 },
              );
            }
            if (!(await supportsImageInput(directory, body))) {
              if (!body || typeof body !== "object" || Array.isArray(body)) {
                return NextResponse.json(
                  { error: "image input is not supported by the selected model" },
                  { status: 400 },
                );
              }
              let nativeError: unknown;
              let nativeRewritten = false;
              if (isQwenNativeVisionAvailable()) {
                try {
                  body = await rewriteNativeRequest(body as Record<string, unknown>, directory);
                  requestBody = new TextEncoder().encode(JSON.stringify(body)).buffer;
                  nativeRewritten = true;
                } catch (error) {
                  nativeError = error;
                }
              }
              if (!nativeRewritten) {
                return NextResponse.json(
                  {
                    error: nativeError
                      ? "画像の事前解析に失敗しました。設定の「モデル」タブで選んだ解析モデルが利用できる状態か確認してください。"
                      : "image input is not supported by the selected model",
                  },
                  { status: nativeError ? 502 : 400 },
                );
              }
            }
          }
        } catch {
          // Preserve the existing behavior for non-JSON or malformed bodies.
        }
      }
      // Convert v1 prompt_async body → v2 prompt body for v2 prompt endpoints.
      if (req.method === "POST" && isV2PromptPath(pathname) && requestBody) {
        try {
          const body = JSON.parse(new TextDecoder().decode(requestBody)) as Record<string, unknown>;
          if (Array.isArray(body.parts)) {
            const converted = v1PromptBodyToV2(body);
            requestBody = new TextEncoder().encode(JSON.stringify(converted)).buffer;
          }
        } catch {
          // Non-JSON or malformed body: pass through unchanged.
        }
      }
      const explicitlyAbortedSessionId =
        abortedSessionId(req.method, pathname) ??
        abortedSessionId(req.method, resolvedPathname);
      if (explicitlyAbortedSessionId) {
        disarmHangWatch(explicitlyAbortedSessionId);
      }
      // Pause any live goal loop on this session before letting a manual send
      // through, so the send cannot interleave with a loop turn. The TaskView
      // client also pauses first for immediate UI feedback; this server-side
      // hook is the authoritative one and also covers other clients, direct API
      // calls and the OpenCode TUI. See docs/specs/goal-loop.md 是正 D.
      const manualSessionId = manualSendSessionId(req.method, pathname);
      if (manualSessionId) {
        for (const workspaceId of findWorkspaceIdsBySession(manualSessionId)) {
          const outcome = await pauseGoalLoopForManualSend(workspaceId, manualSessionId);
          if (outcome === "conflict") {
            return NextResponse.json(
              {
                error:
                  "ループを一時停止できないため手動送信を中止しました。状態が競合したため、現在の状態を確認してから再試行してください。",
              },
              { status: 409 },
            );
          }
        }
        if (/^(?:\/api)?\/session\/[^/]+\/prompt_async$/.test(pathname)) {
          const injection = injectWorkspaceMemory(requestBody, manualSessionId, directory!);
          requestBody = injection.body;
          memoryClaim = injection.claim;
          requestBody = await injectCollaborationContext(
            requestBody,
            manualSessionId,
            directory!,
          );
        }
      }

      const compactionSessionId =
        compactSessionId(req.method, pathname) ??
        compactSessionId(req.method, resolvedPathname);
      if (compactionSessionId) {
        const ownerId = crypto.randomUUID();
        if (!tryAcquireSessionCompactionLock(compactionSessionId, ownerId)) {
          return compactLockConflict();
        }
        compactionLock = { sessionId: compactionSessionId, ownerId };
      }

      // Arm the server-side hang watchdog before the send is forwarded:
      // `session.command` / `session.prompt` block until the turn finishes, so
      // arming afterwards would start watching only once it is already over.
      // See docs/specs/hang-watchdog-server-side.md.
      const watchSessionId = hangWatchSessionId(req.method, pathname);
      if (watchSessionId && directory) {
        try {
          const body = JSON.parse(new TextDecoder().decode(requestBody)) as unknown;
          armHangWatch({
            sessionId: watchSessionId,
            directory,
            requestPath: pathname,
            body,
            timeoutMs: isLongRunningSyncMutation(req.method, pathname)
              ? LONG_RUNNING_UPSTREAM_TIMEOUT_MS
              : UPSTREAM_TIMEOUT_MS,
          });
          armedWatchSessionId = watchSessionId;
        } catch {
          // A non-JSON body cannot be replayed; leave this turn unwatched.
        }
      }
    }
    const upstreamTimeoutMs = isLongRunningSyncMutation(req.method, pathname)
      ? LONG_RUNNING_UPSTREAM_TIMEOUT_MS
      : UPSTREAM_TIMEOUT_MS;
    // SSE: follow the client disconnect (req.signal) and bound only the wait for
    // response headers — an established stream must never be timed out.
    // Other calls: timeout, optionally combined with client abort.
    const clientSignal =
      req.signal && typeof req.signal.aborted === "boolean" ? req.signal : null;
    let signal: AbortSignal;
    if (wantsSse) {
      const connectAbort = new AbortController();
      sseConnectTimer = setTimeout(() => {
        sseConnectTimedOut = true;
        connectAbort.abort();
      }, SSE_UPSTREAM_CONNECT_TIMEOUT_MS);
      if (!clientSignal) {
        signal = connectAbort.signal;
      } else if (typeof AbortSignal.any === "function") {
        signal = AbortSignal.any([clientSignal, connectAbort.signal]);
      } else {
        // Older runtimes without AbortSignal.any: forward the client abort by hand
        // so a disconnected browser still releases the upstream subscription.
        if (clientSignal.aborted) connectAbort.abort();
        else {
          clientSignal.addEventListener("abort", () => connectAbort.abort(), {
            once: true,
          });
        }
        signal = connectAbort.signal;
      }
    } else if (clientSignal && typeof AbortSignal.any === "function") {
      signal = AbortSignal.any([
        AbortSignal.timeout(upstreamTimeoutMs),
        clientSignal,
      ]);
    } else {
      signal = AbortSignal.timeout(upstreamTimeoutMs);
    }
    const init: RequestInit = {
      method: req.method,
      headers,
      redirect: "manual",
      cache: "no-store",
      signal,
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = requestBody;
    }
    // Short-TTL GET response cache for read-only /provider and /agent JSON.
    // Skipped for SSE and for any non-GET method. See getResponseCacheKey.
    if (req.method === "GET") {
      const cacheKey = getResponseCacheKey(directory, pathname);
      if (cacheKey) {
        const cached = getResponseCache.get(cacheKey);
        if (cached && Date.now() - cached.at < GET_RESPONSE_CACHE_TTL_MS) {
          // Refresh TTL position (LRU-ish) and return a fresh Response built
          // from the cached masked JSON. Headers are rebuilt from the
          // cached hop-by-hop-filtered set so secrets stay masked.
          getResponseCache.delete(cacheKey);
          getResponseCache.set(cacheKey, cached);
          const cachedHeaders = new Headers();
          for (const [k, v] of Object.entries(cached.headers)) {
            cachedHeaders.set(k, v);
          }
          cachedHeaders.set("Cache-Control", "no-cache, no-transform");
          if (pathname === "/provider") {
            cachedHeaders.set(
              "Cache-Control",
              "private, max-age=60, stale-while-revalidate=1800",
            );
          }
          return NextResponse.json(cached.body, {
            status: cached.status,
            headers: cachedHeaders,
          });
        }
      }
    }
    upstream = await fetch(target, init);
    clearSseConnectTimer();
    if (compactionLock) {
      releaseSessionCompactionLock(compactionLock.sessionId, compactionLock.ownerId);
      compactionLock = null;
    }
  } catch (err) {
    clearSseConnectTimer();
    // Keep an ambiguous network-failure lock until its TTL expires: the
    // upstream may have accepted the compact even though its response was
    // lost, and releasing immediately would allow a duplicate compact.
    // The send never reached the engine, so there is no turn to watch. A client
    // abort/timeout on a synchronous command is deliberately *not* treated as a
    // failure here: the engine keeps running that turn.
    if (armedWatchSessionId && !(err instanceof DOMException && err.name === "TimeoutError")) {
      disarmHangWatch(armedWatchSessionId);
    }
    // A stalled engine that never starts the stream must surface as a fast,
    // retryable error. Holding the request open instead leaves the browser's
    // EventSource in CONNECTING with no `error` event to reconnect from.
    if (sseConnectTimedOut) {
      return NextResponse.json(
        {
          error: `イベントストリームの接続が${Math.round(
            SSE_UPSTREAM_CONNECT_TIMEOUT_MS / 1000,
          )}秒でタイムアウトしました`,
          detail: "SSE upstream did not send response headers in time",
        },
        { status: 504 },
      );
    }
    // `AbortSignal.timeout` rejects with a DOMException whose raw message is
    // "The operation was aborted due to timeout" — unhelpful when surfaced to
    // the user. Convert it to a clear 408 so long commands report a real
    // timeout instead of a generic engine failure.
    if (err instanceof DOMException && err.name === "TimeoutError") {
      const seconds = Math.round(
        (isLongRunningSyncMutation(req.method, pathname)
          ? LONG_RUNNING_UPSTREAM_TIMEOUT_MS
          : UPSTREAM_TIMEOUT_MS) / 1000,
      );
      return NextResponse.json(
        {
          error: `コマンドが${seconds}秒でタイムアウトしました`,
          detail: "OpenCode engine did not respond within the timeout",
        },
        { status: 408 },
      );
    }
    const message = err instanceof Error ? err.message : "upstream unreachable";
    return NextResponse.json(
      { error: "OpenCode engine unavailable", detail: message },
      { status: 503 },
    );
  }

  // A rejected send (invalid model, unknown session…) never started a turn.
  if (memoryClaim && !upstream.ok) {
    releaseMemoryInjectionClaim(memoryClaim.workspaceId, memoryClaim.sessionId);
    memoryClaim = null;
  }
  if (armedWatchSessionId && !upstream.ok) {
    disarmHangWatch(armedWatchSessionId);
  }
  if (armedWatchSessionId && upstream.ok && isLongRunningSyncMutation(req.method, pathname)) {
    // Synchronous command/prompt/message responses are returned only after the
    // engine finishes the turn. There is no remaining turn for the watchdog to
    // recover, even if the transcript is tool-only or otherwise textless.
    disarmHangWatch(armedWatchSessionId);
  }

  // A successful compact can discard the original workspace-memory and
  // collaboration blocks from the active context. Allow both injections on
  // the next prompt so the model regains that durable context. The compact
  // endpoint returns only after OpenCode accepts the operation; the stream
  // separately refreshes the visible transcript on session.compacted.
  const compactedSessionId =
    compactSessionId(req.method, pathname) ??
    compactSessionId(req.method, resolvedPathname);
  if (upstream.ok && compactedSessionId) {
    for (const workspaceId of findWorkspaceIdsBySession(compactedSessionId)) {
      releaseMemoryInjectionClaim(workspaceId, compactedSessionId);
      markCollaborationSnapshotCompacted(workspaceId, compactedSessionId);
    }
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (req.method === "GET" && (pathname === "/provider" || pathname === "/agent")) {
    await cacheCapabilityMetadata(directory, pathname, upstream);
  }
  const isSse = contentType.includes("text/event-stream") || wantsSse;

  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    outHeaders.set(key, value);
  });
  outHeaders.set("Cache-Control", "no-cache, no-transform");
  if (isSse) {
    outHeaders.set("Content-Type", "text/event-stream; charset=utf-8");
    outHeaders.set("Connection", "keep-alive");
    outHeaders.set("X-Accel-Buffering", "no");
  }
  // /provider GET is read-only, directory-independent provider metadata with
  // secrets already masked; let the browser's HTTP cache serve it briefly.
  if (req.method === "GET" && pathname === "/provider") {
    outHeaders.set(
      "Cache-Control",
      "private, max-age=60, stale-while-revalidate=1800",
    );
  }

  // Mask secrets on config/provider GET JSON responses (exact + prefix).
  // Exact-only matching left `/provider/<id>` unmasked (R52).
  // v2 paths under `/api/provider` must be covered too.
  const shouldMaskSecrets =
    pathname === "/config" ||
    pathname === "/global/config" ||
    pathname.startsWith("/provider") ||
    pathname.startsWith("/api/provider") ||
    pathname.startsWith("/config/") ||
    pathname.startsWith("/api/config/");
  if (
    req.method === "GET" &&
    shouldMaskSecrets &&
    contentType.includes("application/json")
  ) {
    const json = await upstream.json();
    const masked = maskSecrets(json);
    // Cache the masked /provider response so the next Home boot burst hit
    // (e.g. /api/extensions/provider-models following /api/opencode/provider)
    // is an in-memory return. /config and other shouldMaskSecrets paths are
    // intentionally NOT cached here — only /provider and /agent are wired in
    // getResponseCacheKey.
    const cacheKey = getResponseCacheKey(directory, pathname);
    if (cacheKey && upstream.ok) {
      const headers: Record<string, string> = {};
      outHeaders.forEach((value, key) => {
        headers[key] = value;
      });
      storeGetResponseCache(cacheKey, {
        at: Date.now(),
        status: upstream.status,
        headers,
        body: masked,
      });
    }
    return NextResponse.json(masked, {
      status: upstream.status,
      headers: outHeaders,
    });
  }

  // /agent GET JSON is not secret-masked but is read-only metadata that the
  // Home composer fetches alongside /provider in the same burst. Cache the
  // parsed JSON for the same short TTL so the second hit is in-memory.
  if (
    req.method === "GET" &&
    pathname === "/agent" &&
    contentType.includes("application/json") &&
    upstream.ok
  ) {
    const json = await upstream.json();
    const cacheKey = getResponseCacheKey(directory, pathname);
    if (cacheKey) {
      const headers: Record<string, string> = {};
      outHeaders.forEach((value, key) => {
        headers[key] = value;
      });
      storeGetResponseCache(cacheKey, {
        at: Date.now(),
        status: upstream.status,
        headers,
        body: json,
      });
    }
    return NextResponse.json(json, {
      status: upstream.status,
      headers: outHeaders,
    });
  }

  if (isSse && upstream.body) {
    const reader = upstream.body.getReader();
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        // Initial comment heartbeat help for some proxies
        controller.enqueue(encoder.encode(": connected\n\n"));
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(encodeSseHeartbeat()));
          } catch {
            clearInterval(heartbeat);
          }
        }, SSE_HEARTBEAT_MS);
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch {
          // client or upstream closed
        } finally {
          clearInterval(heartbeat);
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        }
      },
      cancel() {
        reader.cancel().catch(() => undefined);
      },
    });
    return new Response(stream, { status: upstream.status, headers: outHeaders });
  }

  const unwrapped = await maybeUnwrapV2Data(upstream, pathname, outHeaders, isSse);
  if (unwrapped) return unwrapped;

  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}

/**
 * v2 API responses are wrapped in `{ data: T }`. Unwrap them so existing v1
 * client code sees the same shape it did before the migration. SSE and
 * error responses (non-2xx) are passed through unchanged. Secret-masked
 * endpoints (/provider, /config) already handle their own JSON parsing above.
 */
