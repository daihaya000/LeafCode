import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import {
  extensionsErrorResponse,
  parsePluginBody,
} from "@/lib/opencode-extensions/http";
import {
  addConfiguredPlugin,
  listPlugins,
} from "@/lib/opencode-extensions/plugins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  try {
    return NextResponse.json({ plugins: await listPlugins() });
  } catch (err) {
    return extensionsErrorResponse(err, "プラグイン一覧を取得できません");
  }
}

export async function POST(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = await req.json().catch(() => undefined);
  const parsed = parsePluginBody(body);
  if ("error" in parsed) return parsed.error;
  try {
    await addConfiguredPlugin(parsed);
    return NextResponse.json({ ok: true, requiresRestart: true });
  } catch (err) {
    return extensionsErrorResponse(err, "プラグインを登録できません");
  }
}
