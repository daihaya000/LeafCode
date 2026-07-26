import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { directoryHeaders, withDirectoryQuery } from "@/lib/directory-header";
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
  encodeSseHeartbeat,
} from "@/lib/sse-health";

/** Upstream JSON/proxy timeout; SSE paths omit this so streams stay open. */
const UPSTREAM_TIMEOUT_MS = 90_000;

/**
 * Synchronous mutations (session.command / session.prompt) block until the
 * engine finishes running the command, which can far exceed the default proxy
 * timeout (e.g. `/loop 2m`). Give them room up to maxDuration so a legitimately
 * long-running command is not aborted mid-flight. Kept just under maxDuration
 * (300s) so the abort—not the platform—produces the response.
 */
const LONG_RUNNING_UPSTREAM_TIMEOUT_MS = 290_000;

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

function containsImagePart(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const { parts } = body as { parts?: unknown };
  return (
    Array.isArray(parts) &&
    parts.some(
      (part) =>
        part &&
        typeof part === "object" &&
        !Array.isArray(part) &&
        (part as { type?: unknown }).type === "file" &&
        typeof (part as { mime?: unknown }).mime === "string" &&
        /^image\//i.test((part as { mime: string }).mime),
    )
  );
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
  if (!body || typeof body !== "object" || Array.isArray(body)) return true;
  const { parts } = body as { parts?: unknown };
  if (!Array.isArray(parts)) return true;
  const images = parts.filter(
    (part) =>
      part &&
      typeof part === "object" &&
      !Array.isArray(part) &&
      (part as { type?: unknown }).type === "file" &&
      typeof (part as { mime?: unknown }).mime === "string" &&
      /^image\//i.test((part as { mime: string }).mime),
  );
  if (images.length > MAX_IMAGE_COUNT) return false;
  for (const part of images) {
    const url = (part as { url?: unknown }).url;
    if (typeof url === "string" && estimateDataUrlBytes(url) > MAX_IMAGE_SIZE_BYTES) {
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
  const directory =
    req.headers.get("x-opencode-directory") ??
    incoming.searchParams.get("directory");

  // Global health/event endpoints do not require directory
  const needsDirectory =
    !pathname.startsWith("/global/") &&
    pathname !== "/doc" &&
    pathname !== "/";

  if (needsDirectory && directory) {
    const check = assertAllowedDirectory(directory);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }
  } else if (needsDirectory && !directory) {
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
  }

  const target = new URL(pathname + incoming.search, OPENCODE_BASE_URL);
  // Defense in depth: the allowlist check above validated `directory` (header
  // preferred). Always set the validated `?directory=` on the upstream URL so
  // a mismatched header/query pair cannot smuggle an unvalidated path through
  // to OpenCode. The query is safe for non-Latin-1 paths (URLSearchParams
  // percent-encodes), while the header below is omitted for unsafe values.
  if (directory) {
    withDirectoryQuery(target, directory);
  }

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    headers.set(key, value);
  });
  for (const [key, value] of Object.entries(directoryHeaders(directory))) {
    headers.set(key, value);
  }

  let requestBody: ArrayBuffer | undefined;
  let upstream: Response;
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      requestBody = await req.arrayBuffer();
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
    }
    const wantsSse =
      pathname === "/event" || pathname === "/global/event";
    const upstreamTimeoutMs = isLongRunningSyncMutation(req.method, pathname)
      ? LONG_RUNNING_UPSTREAM_TIMEOUT_MS
      : UPSTREAM_TIMEOUT_MS;
    // SSE: follow the client disconnect (req.signal) with no idle timeout.
    // Other calls: timeout, optionally combined with client abort.
    const clientSignal =
      req.signal && typeof req.signal.aborted === "boolean" ? req.signal : null;
    let signal: AbortSignal;
    if (wantsSse) {
      signal = clientSignal ?? AbortSignal.timeout(2_147_483_647);
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
  } catch (err) {
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
  const isSse =
    contentType.includes("text/event-stream") ||
    pathname === "/event" ||
    pathname === "/global/event";

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
