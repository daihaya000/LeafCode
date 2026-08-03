import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { findWorkspaceIdsBySession } from "@/lib/db";
import { directoryHeaders, withDirectoryQuery } from "@/lib/directory-header";
import { pauseGoalLoopForManualSend } from "@/lib/goal-loop";
import { isIntelligenceVariant } from "@/lib/model-variants";
import { ocServer } from "@/lib/oc-server";
import {
  OPENCODE_BASE_URL,
  isBlockedOpencodeWrite,
  maskSecrets,
} from "@/lib/opencode";
import { resolvedOpenCodePathname } from "@/lib/opencode-id";
import {
  SSE_HEARTBEAT_MS,
  SSE_UPSTREAM_CONNECT_TIMEOUT_MS,
  encodeSseHeartbeat,
} from "@/lib/sse-health";

/** Upstream JSON/proxy timeout; SSE paths omit this so streams stay open. */
const UPSTREAM_TIMEOUT_MS = 90_000;

/**
 * Synchronous mutations (session.command / session.prompt) block until the
 * engine finishes running the command. Keep this below the route's 300s
 * maxDuration while allowing legitimate five-minute commands to finish.
 */
const LONG_RUNNING_UPSTREAM_TIMEOUT_MS = 290_000;

/**
 * A prompt/command written straight into a session. Any of these is a "manual
 * send" from the goal loop's point of view and must pause a live loop first.
 *
 * The loop's own prompts never reach this proxy: `goal-loop.ts` calls the engine
 * through `ocServer` directly, so this hook cannot pause the loop against
 * itself. See docs/specs/goal-loop.md invariant I9.
 */
function manualSendSessionId(method: string, pathname: string): string | null {
  if (method !== "POST") return null;
  const match = /^\/session\/([^/]+)\/(?:prompt_async|prompt|command)$/.exec(pathname);
  return match ? match[1] : null;
}

/** Match the synchronous, completion-blocking mutation endpoints. */
function isLongRunningSyncMutation(method: string, pathname: string): boolean {
  if (method !== "POST") return false;
  return (
    /^\/session\/[^/]+\/command$/.test(pathname) ||
    /^\/session\/[^/]+\/prompt$/.test(pathname) ||
    /^\/session\/[^/]+\/message$/.test(pathname) ||
    /^\/api\/session\/[^/]+\/prompt$/.test(pathname)
  );
}

/** Session create / update paths that accept a permission ruleset in the body. */
function isSessionPermissionWrite(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  if (m === "POST") {
    return pathname === "/session" || pathname === "/api/session";
  }
  if (m === "PATCH") {
    return (
      /^\/session\/[^/]+$/.test(pathname) ||
      /^\/api\/session\/[^/]+$/.test(pathname)
    );
  }
  return false;
}

function bodyHasPermissionField(body: unknown): boolean {
  return (
    !!body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.prototype.hasOwnProperty.call(body, "permission")
  );
}

/** Session write paths that can carry image parts (R28 limits + capability). */
function isImageGuardedWrite(pathname: string): boolean {
  return (
    /^\/session\/[^/]+\/prompt_async$/.test(pathname) ||
    /^\/session\/[^/]+\/command$/.test(pathname) ||
    /^\/session\/[^/]+\/prompt$/.test(pathname) ||
    /^\/session\/[^/]+\/message$/.test(pathname) ||
    /^\/api\/session\/[^/]+\/prompt$/.test(pathname)
  );
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  // fetch() already decompressed the body — forwarding these corrupts responses
  "content-encoding",
  "accept-encoding",
]);

type ProviderModel = {
  capabilities?: {
    attachment?: boolean;
    input?: { image?: boolean };
  };
};
type ProviderResponse = {
  all?: { id?: string; models?: Record<string, ProviderModel> }[];
  connected?: string[];
};
type AgentResponse = {
  name?: string;
  model?: { providerID?: string; modelID?: string };
}[];

// The composer requests these read endpoints before it sends a follow-up.
// Keep only their capability/model metadata so this write proxy can enforce the
// same fail-closed decision without forwarding an unsupported prompt first.
// Cache per directory to avoid cross-project contamination in multi-project setups.
const cachedProvidersByDir = new Map<string, ProviderResponse>();
const cachedAgentsByDir = new Map<string, AgentResponse>();

type ImageAttachment = { mime: string; dataUrl: string };

/** Collect image attachments from v1 `parts` and v2 `prompt.files` shapes. */
function collectImageAttachments(body: unknown): ImageAttachment[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const record = body as Record<string, unknown>;
  const out: ImageAttachment[] = [];

  const pushImage = (mime: unknown, dataUrl: unknown) => {
    if (typeof mime !== "string" || !/^image\//i.test(mime)) return;
    out.push({
      mime,
      dataUrl: typeof dataUrl === "string" ? dataUrl : "",
    });
  };

  if (Array.isArray(record.parts)) {
    for (const part of record.parts) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const p = part as Record<string, unknown>;
      if (p.type !== "file") continue;
      pushImage(p.mime, typeof p.url === "string" ? p.url : p.uri);
    }
  }

  const prompt = record.prompt;
  if (prompt && typeof prompt === "object" && !Array.isArray(prompt)) {
    const files = (prompt as { files?: unknown }).files;
    if (Array.isArray(files)) {
      for (const file of files) {
        if (!file || typeof file !== "object" || Array.isArray(file)) continue;
        const f = file as Record<string, unknown>;
        pushImage(f.mime, typeof f.uri === "string" ? f.uri : f.url);
      }
    }
  }

  return out;
}

function containsImagePart(body: unknown): boolean {
  return collectImageAttachments(body).length > 0;
}

// Match POST /api/tasks R28 limits so session write paths cannot bypass them.
const MAX_IMAGE_COUNT = 10;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

function estimateDataUrlBytes(uri: string): number {
  const comma = uri.indexOf(",");
  if (comma < 0) return Number.POSITIVE_INFINITY;
  const b64 = uri.slice(comma + 1);
  return Math.floor((b64.length * 3) / 4);
}

/** Returns false when image parts exceed count or per-image size limits. */
function imagePartsWithinLimits(body: unknown): boolean {
  const images = collectImageAttachments(body);
  if (images.length === 0) return true;
  if (images.length > MAX_IMAGE_COUNT) return false;
  for (const image of images) {
    // Missing / non-data URLs cannot be size-checked — fail closed.
    if (!image.dataUrl || estimateDataUrlBytes(image.dataUrl) > MAX_IMAGE_SIZE_BYTES) {
      return false;
    }
  }
  return true;
}

function modelFromRequest(body: Record<string, unknown>):
  | { providerID: string; modelID: string }
  | undefined {
  const model = body.model;
  if (typeof model === "string") {
    const slash = model.indexOf("/");
    if (slash > 0 && slash < model.length - 1) {
      return {
        providerID: model.slice(0, slash),
        modelID: model.slice(slash + 1),
      };
    }
    return undefined;
  }
  if (!model || typeof model !== "object" || Array.isArray(model)) {
    return undefined;
  }
  const { providerID, modelID } = model as {
    providerID?: unknown;
    modelID?: unknown;
  };
  return typeof providerID === "string" && typeof modelID === "string"
    ? { providerID, modelID }
    : undefined;
}

// Resolves `/agent`, preferring the per-directory cache seeded by an earlier
// directory-scoped GET (see cacheCapabilityMetadata). If unseeded — e.g. the
// composer only ever fetched it without a `directory`, which is never cached
// — fall back to a live, directory-scoped query so capability enforcement
// does not incorrectly fail-closed for a directory whose cache never filled.
async function resolveAgents(directory: string | null): Promise<AgentResponse | undefined> {
  const cached = directory ? cachedAgentsByDir.get(directory) : undefined;
  if (cached) return cached;
  try {
    const agents = await ocServer<AgentResponse>(directory, "/agent");
    if (directory) cachedAgentsByDir.set(directory, agents);
    return agents;
  } catch {
    return undefined;
  }
}

// Same directory-scoped cache-then-live-fallback strategy as resolveAgents,
// mirroring the supportsImageInput() implementation in /api/tasks so both
// write paths make the same fail-closed decision from the same source of
// truth (OpenCode's live /provider capabilities for this directory).
async function resolveProviders(directory: string | null): Promise<ProviderResponse | undefined> {
  const cached = directory ? cachedProvidersByDir.get(directory) : undefined;
  if (cached) return cached;
  try {
    const providers = await ocServer<ProviderResponse>(directory, "/provider");
    if (directory) cachedProvidersByDir.set(directory, providers);
    return providers;
  } catch {
    return undefined;
  }
}

async function supportsImageInput(
  directory: string | null,
  body: unknown,
): Promise<boolean> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const request = body as Record<string, unknown>;
  let model = modelFromRequest(request);
  const agent = request.agent;
  if (typeof agent === "string" && agent.trim()) {
    const agents = await resolveAgents(directory);
    const configuredAgent = agents?.find(({ name }) => name === agent.trim());
    const agentModel = configuredAgent?.model;
    // Prefer the agent's own model when it is configured; otherwise fall back
    // to the model explicitly selected in the request. This lets an
    // image-capable model chosen at request time apply to agents that have no
    // per-agent model, instead of fail-closing on the missing agent model.
    if (agentModel?.providerID && agentModel.modelID) {
      model = {
        providerID: agentModel.providerID,
        modelID: agentModel.modelID,
      };
    }
  }
  if (!model?.providerID || !model.modelID) return false;
  const providers = await resolveProviders(directory);
  // Unreachable/unavailable provider metadata is fail-closed: without a
  // confirmed capability we cannot allow the image through.
  if (!providers) return false;
  if (
    providers.connected?.length &&
    !providers.connected.includes(model.providerID)
  ) {
    return false;
  }
  const capabilities = providers.all
    ?.find((provider) => provider.id === model.providerID)
    ?.models?.[model.modelID]?.capabilities;
  return capabilities?.input?.image === true || capabilities?.attachment === true;
}

async function cacheCapabilityMetadata(
  directory: string | null,
  pathname: string,
  upstream: Response,
): Promise<void> {
  if (!directory) return; // Cannot cache without directory key
  if (!upstream.ok || !upstream.headers.get("content-type")?.includes("application/json")) {
    return;
  }
  try {
    const payload = await upstream.clone().json();
    if (pathname === "/provider") cachedProvidersByDir.set(directory, payload as ProviderResponse);
    if (pathname === "/agent" && Array.isArray(payload)) {
      cachedAgentsByDir.set(directory, payload as AgentResponse);
    }
  } catch {
    // A malformed metadata response leaves the cache unavailable, which is
    // fail-closed for subsequent image submissions.
  }
}

async function proxy(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
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
      { error: "OpenCode config/auth/mcp writes are disabled in WebUI" },
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

  const wantsSse = pathname === "/event" || pathname === "/global/event";

  let requestBody: ArrayBuffer | undefined;
  let upstream: Response;
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
          const body = JSON.parse(new TextDecoder().decode(requestBody)) as unknown;
          const variant =
            body && typeof body === "object" && !Array.isArray(body)
              ? (body as { variant?: unknown }).variant
              : undefined;
          if (
            /^\/session\/[^/]+\/prompt_async$/.test(pathname) &&
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
              return NextResponse.json(
                { error: "image input is not supported by the selected model" },
                { status: 400 },
              );
            }
          }
        } catch {
          // Preserve the existing behavior for non-JSON or malformed bodies.
        }
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
    upstream = await fetch(target, init);
    clearSseConnectTimer();
  } catch (err) {
    clearSseConnectTimer();
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
    return NextResponse.json(maskSecrets(json), {
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

  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
