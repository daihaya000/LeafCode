import { NextRequest, NextResponse } from "next/server";
import {
  extensionsErrorResponse,
  parseEnabledBody,
  parseIconBody,
} from "@/lib/opencode-extensions/http";
import { setProviderModelEnabled } from "@/lib/opencode-extensions/provider-models";
import { updateCustomProvider } from "@/lib/opencode-extensions/provider-models";
import { setProviderIconOverride } from "@/lib/opencode-extensions/provider-models";
import { deleteCustomProvider } from "@/lib/opencode-extensions/provider-models";
import { setModelPricing } from "@/lib/provider-model-state";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isIconBody(body: unknown): boolean {
  return (
    !!body && typeof body === "object" && !Array.isArray(body) && "icon" in body
  );
}

function isPricingBody(body: unknown): boolean {
  return (
    !!body && typeof body === "object" && !Array.isArray(body) && "pricing" in body
  );
}

/**
 * Parse a manual pricing body: `{ pricing: { input, output, cachedInput?,
 * cacheWrite? } | null }`. `null` clears the entry. All prices are USD per 1M
 * tokens and must be non-negative finite numbers.
 */
function parsePricingBody(
  body: unknown,
): { pricing: { input: number; output: number; cachedInput?: number; cacheWrite?: number } | undefined } | { error: NextResponse } {
  const pricing =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { pricing?: unknown }).pricing
      : undefined;
  if (pricing === null || pricing === undefined) return { pricing: undefined };
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) {
    return {
      error: NextResponse.json(
        { error: "pricing はオブジェクトで指定してください" },
        { status: 400 },
      ),
    };
  }
  const p = pricing as Record<string, unknown>;
  const input = typeof p.input === "number" ? p.input : NaN;
  const output = typeof p.output === "number" ? p.output : NaN;
  if (!Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) {
    return {
      error: NextResponse.json(
        { error: "input と output は 0 以上の数値で指定してください" },
        { status: 400 },
      ),
    };
  }
  const cachedInput = typeof p.cachedInput === "number" ? p.cachedInput : undefined;
  const cacheWrite = typeof p.cacheWrite === "number" ? p.cacheWrite : undefined;
  if (
    (cachedInput !== undefined && (!Number.isFinite(cachedInput) || cachedInput < 0)) ||
    (cacheWrite !== undefined && (!Number.isFinite(cacheWrite) || cacheWrite < 0))
  ) {
    return {
      error: NextResponse.json(
        { error: "cachedInput と cacheWrite は 0 以上の数値で指定してください" },
        { status: 400 },
      ),
    };
  }
  return {
    pricing: {
      input,
      output,
      ...(cachedInput !== undefined ? { cachedInput } : {}),
      ...(cacheWrite !== undefined ? { cacheWrite } : {}),
    },
  };
}

/**
 * `{ icon }` sets a WebUI-local icon override for any provider (built-in or
 * custom), without touching `opencode.jsonc`. `{ enabled }` keeps the
 * existing enable/disable toggle behavior.
 */
export async function PATCH(req: NextRequest,
  context: { params: Promise<{ key: string }> },) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { key } = await context.params;
  const body = await req.json().catch(() => undefined);

  if (isIconBody(body)) {
    const parsed = parseIconBody(body);
    if ("error" in parsed) return parsed.error;
    try {
      await setProviderIconOverride(decodeURIComponent(key), parsed.icon);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return extensionsErrorResponse(err, "アイコンを更新できません");
    }
  }

  if (isPricingBody(body)) {
    const parsed = parsePricingBody(body);
    if ("error" in parsed) return parsed.error;
    try {
      await setModelPricing(decodeURIComponent(key), parsed.pricing);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return extensionsErrorResponse(err, "価格設定を更新できません");
    }
  }

  const parsed = parseEnabledBody(body);
  if ("error" in parsed) return parsed.error;
  try {
    await setProviderModelEnabled(
      decodeURIComponent(key),
      parsed.enabled,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return extensionsErrorResponse(err);
  }
}

type CustomProviderBody = {
  name?: unknown;
  baseURL?: unknown;
  apiKeyEnv?: unknown;
  icon?: unknown;
  npm?: unknown;
  models?: unknown;
};

function parseCustomProviderBody(body: CustomProviderBody) {
  const models = Array.isArray(body.models)
    ? body.models
        .filter((model) => model && typeof model === "object")
        .map((model) => {
          const item = model as { id?: unknown; name?: unknown };
          return {
            id: typeof item.id === "string" ? item.id : "",
            name: typeof item.name === "string" ? item.name : undefined,
          };
        })
    : [];
  return {
    id: "",
    name: typeof body.name === "string" ? body.name : "",
    baseURL: typeof body.baseURL === "string" ? body.baseURL : "",
    apiKeyEnv: typeof body.apiKeyEnv === "string" ? body.apiKeyEnv : undefined,
    icon: typeof body.icon === "string" ? body.icon : undefined,
    npm: typeof body.npm === "string" ? body.npm : undefined,
    models,
  };
}

export async function PUT(req: NextRequest,
  context: { params: Promise<{ key: string }> },) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { key } = await context.params;
  const body = (await req.json().catch(() => undefined)) as
    | CustomProviderBody
    | undefined;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  try {
    await updateCustomProvider(decodeURIComponent(key), parseCustomProviderBody(body));
    return NextResponse.json({ ok: true, requiresRestart: true });
  } catch (err) {
    return extensionsErrorResponse(err, "プロバイダー設定を更新できません");
  }
}

/**
 * Remove a configured provider's `provider.<id>` entry from
 * `opencode.jsonc` and its WebUI-local state. Only providers that exist in
 * the config can be deleted; built-in providers return `not-found`.
 */
export async function DELETE(req: NextRequest,
  context: { params: Promise<{ key: string }> },) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { key } = await context.params;
  try {
    await deleteCustomProvider(decodeURIComponent(key));
    return NextResponse.json({ ok: true, requiresRestart: true });
  } catch (err) {
    return extensionsErrorResponse(err, "プロバイダーを削除できません");
  }
}
