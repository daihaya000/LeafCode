import { NextResponse } from "next/server";
import { readProfileSetupSettings, writeProfileSetupSettings } from "@/lib/profiles/settings";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  return NextResponse.json(readProfileSetupSettings());
}

export async function PUT(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => undefined)) as
    | { browserBridge?: unknown; qwenMm?: unknown; cursorAcp?: unknown; claudeAuth?: unknown; commandcodeAuth?: unknown }
    | undefined;
  if (
    typeof body?.browserBridge !== "boolean" ||
    typeof body.qwenMm !== "boolean" ||
    typeof body.cursorAcp !== "boolean" ||
    typeof body.claudeAuth !== "boolean" ||
    typeof body.commandcodeAuth !== "boolean"
  ) {
    return NextResponse.json({ error: "自動セットアップ設定が不正です" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      writeProfileSetupSettings({
        browserBridge: body.browserBridge,
        qwenMm: body.qwenMm,
        cursorAcp: body.cursorAcp,
        claudeAuth: body.claudeAuth,
        commandcodeAuth: body.commandcodeAuth,
      }),
    );
  } catch {
    return NextResponse.json({ error: "自動セットアップ設定を保存できません" }, { status: 500 });
  }
}
