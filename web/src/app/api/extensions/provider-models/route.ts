import { NextResponse } from "next/server";
import { extensionsErrorResponse } from "@/lib/opencode-extensions/http";
import {
  addCustomProvider,
  listProviderModels,
} from "@/lib/opencode-extensions/provider-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      providers: await listProviderModels(),
    });
  } catch (err) {
    return extensionsErrorResponse(
      err,
      "プロバイダー一覧を取得できません",
    );
  }
}

type CustomProviderBody = {
  id?: unknown;
  name?: unknown;
  baseURL?: unknown;
  apiKeyEnv?: unknown;
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
    id: typeof body.id === "string" ? body.id : "",
    name: typeof body.name === "string" ? body.name : "",
    baseURL: typeof body.baseURL === "string" ? body.baseURL : "",
    apiKeyEnv: typeof body.apiKeyEnv === "string" ? body.apiKeyEnv : undefined,
    npm: typeof body.npm === "string" ? body.npm : undefined,
    models,
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => undefined)) as
    | CustomProviderBody
    | undefined;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  try {
    await addCustomProvider(parseCustomProviderBody(body));
    return NextResponse.json({ ok: true, requiresRestart: true });
  } catch (err) {
    return extensionsErrorResponse(err, "プロバイダーを登録できません");
  }
}
