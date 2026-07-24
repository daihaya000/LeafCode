import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { isIntelligenceVariant } from "@/lib/model-variants";
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

function supportsImageInput(directory: string | null, body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const request = body as Record<string, unknown>;
  let model = modelFromRequest(request);
  const agent = request.agent;
  const cachedAgents = directory ? cachedAgentsByDir.get(directory) : undefined;
  const cachedProviders = directory ? cachedProvidersByDir.get(directory) : undefined;
  if (typeof agent === "string" && agent.trim()) {
    const configuredAgent = cachedAgents?.find(({ name }) => name === agent.trim());
    const agentModel = configuredAgent?.model;
    if (!agentModel?.providerID || !agentModel.modelID) {
      return false;
    }
    model = {
      providerID: agentModel.providerID,
      modelID: agentModel.modelID,
    };
  }
  if (!model?.providerID || !model.modelID) return false;
  if (
    cachedProviders?.connected?.length &&
    !cachedProviders.connected.includes(model.providerID)
  ) {
    return false;
  }
  const capabilities = cachedProviders?.all
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
        pathname.startsWith("/mcp") ||
        pathname === "/path" ||
        pathname === "/agent" ||
        pathname === "/command" ||
        pathname === "/skill" ||
        pathname.startsWith("/event"));
    if (!allowWithoutDir) {
      return NextResponse.json(
        { error: "x-opencode-directory (or ?directory=) is required" },
        { status: 400 },
      );
    }
  }

  const target = new URL(pathname + incoming.search, OPENCODE_BASE_URL);
  // Defense in depth: the allowlist check above validated `directory` (header
  // preferred). Overwrite any `?directory=` query the caller may have sent with
  // the validated value so a mismatched header/query pair cannot smuggle an
  // unvalidated path through to OpenCode.
  if (directory && target.searchParams.has("directory")) {
    target.searchParams.set("directory", directory);
  }

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    headers.set(key, value);
  });
  if (directory) {
    headers.set("x-opencode-directory", directory);
  }

  let requestBody: ArrayBuffer | undefined;
  let upstream: Response;
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      requestBody = await req.arrayBuffer();
      if (
        req.method === "POST" &&
        (/^\/session\/[^/]+\/prompt_async$/.test(pathname) ||
          /^\/session\/[^/]+\/command$/.test(pathname))
      ) {
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
          if (
            (/^\/session\/[^/]+\/prompt_async$/.test(pathname) ||
              /^\/session\/[^/]+\/command$/.test(pathname)) &&
            containsImagePart(body) &&
            !supportsImageInput(directory, body)
          ) {
            return NextResponse.json(
              { error: "image input is not supported by the selected model" },
              { status: 400 },
            );
          }
        } catch {
          // Preserve the existing behavior for non-JSON or malformed bodies.
        }
      }
    }
    const wantsSse =
      pathname === "/event" || pathname === "/global/event";
    const init: RequestInit = {
      method: req.method,
      headers,
      redirect: "manual",
      cache: "no-store",
      // Long-lived SSE must not inherit a request timeout.
      ...(wantsSse ? {} : { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }),
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = requestBody;
    }
    upstream = await fetch(target, init);
  } catch (err) {
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

  // Mask secrets on config/provider GET JSON responses
  const MASKED_GET_PATHS = new Set([
    "/config",
    "/provider",
    "/config/providers",
    "/global/config",
  ]);
  if (
    req.method === "GET" &&
    MASKED_GET_PATHS.has(pathname) &&
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
