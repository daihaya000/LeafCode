import { NextResponse } from "next/server";

/**
 * v1/v2 generation handling for the BFF proxy (REFACTORING_PLAN P4-a):
 * path detection, v1 prompt-body → v2 prompt-body conversion, and unwrapping
 * single-key `{ data }` envelopes in upstream JSON responses.
 */

export function isV2Path(pathname: string): boolean {
  return pathname.startsWith("/api/") && !pathname.startsWith("/api/opencode/");
}

/**
 * Convert a v1 `prompt_async` body shape to a v2 `prompt` body shape.
 *
 * v1: `{ messageID, model: {providerID, modelID}, agent, parts: [{type:"text", text}, {type:"file", url, mime, filename}], variant, ... }`
 * v2: `{ id, prompt: { text, files: [{uri, name}], agents: [{name}] }, delivery: "steer" }`
 *
 * Only transforms when the body has a `parts` array (the v1 signature). Bodies
 * that are already in v2 shape (with a `prompt` field) are passed through.
 */
export function v1PromptBodyToV2(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.parts)) return body;
  const textParts: string[] = [];
  const fileParts: Array<{ uri: string; name?: string; source?: unknown }> = [];
  const agentParts: Array<{ name: string; source?: unknown }> = [];

  for (const part of body.parts) {
    if (!part || typeof part !== "object" || Array.isArray(part)) continue;
    const p = part as Record<string, unknown>;
    if (p.type === "text" && typeof p.text === "string") {
      textParts.push(p.text);
    } else if (p.type === "file") {
      const uri = typeof p.url === "string" ? p.url : typeof p.uri === "string" ? p.uri : "";
      if (uri) fileParts.push({ uri, name: typeof p.filename === "string" ? p.filename : undefined, source: p.source });
    } else if (p.type === "agent") {
      if (typeof p.name === "string") agentParts.push({ name: p.name, source: p.source });
    }
  }

  const prompt: Record<string, unknown> = { text: textParts.join("\n") };
  if (fileParts.length > 0) prompt.files = fileParts;
  if (agentParts.length > 0) prompt.agents = agentParts;

  const v2: Record<string, unknown> = { prompt };
  if (typeof body.messageID === "string") v2.id = body.messageID;
  v2.delivery = "steer";
  return v2;
}

/** True when the request targets a v2 prompt endpoint with a v1-style body. */
export function isV2PromptPath(pathname: string): boolean {
  return /^\/api\/session\/[^/]+\/prompt$/.test(pathname);
}

export function maybeUnwrapV2Data(
  upstream: Response,
  pathname: string,
  outHeaders: Headers,
  isSse: boolean,
): Promise<Response | null> {
  if (isSse) return Promise.resolve(null);
  if (!isV2Path(pathname)) return Promise.resolve(null);
  const ct = upstream.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return Promise.resolve(null);
  if (!upstream.ok) return Promise.resolve(null);
  if (upstream.status === 204 || upstream.status === 205) return Promise.resolve(null);

  return upstream.json().then(
    (json: unknown) => {
      if (
        json &&
        typeof json === "object" &&
        !Array.isArray(json) &&
        Object.prototype.hasOwnProperty.call(json, "data") &&
        Object.keys(json as Record<string, unknown>).length === 1
      ) {
        const unwrapped = (json as { data: unknown }).data;
        return NextResponse.json(unwrapped, {
          status: upstream.status,
          headers: outHeaders,
        });
      }
      return null;
    },
    () => null,
  );
}
