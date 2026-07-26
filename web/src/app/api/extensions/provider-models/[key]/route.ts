import { NextRequest, NextResponse } from "next/server";
import {
  extensionsErrorResponse,
  parseEnabledBody,
} from "@/lib/opencode-extensions/http";
import { setProviderModelEnabled } from "@/lib/opencode-extensions/provider-models";
import { updateCustomProvider } from "@/lib/opencode-extensions/provider-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ key: string }> },
) {
  const { key } = await context.params;
  const body = await req.json().catch(() => undefined);
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

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ key: string }> },
) {
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
