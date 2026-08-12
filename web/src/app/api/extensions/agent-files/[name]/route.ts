import { NextRequest, NextResponse } from "next/server";
import {
  deleteAgentFile,
  readAgentFile,
  setAgentFileEnabled,
  writeAgentFile,
} from "@/lib/opencode-extensions/agent-files";
import {
  extensionsErrorResponse,
  parseEnabledBody,
} from "@/lib/opencode-extensions/http";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ name: string }> };

export async function GET(req: NextRequest, context: Context) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { name } = await context.params;
  try {
    return NextResponse.json({ file: readAgentFile(decodeURIComponent(name)) });
  } catch (err) {
    return extensionsErrorResponse(err, "エージェント定義の読み込みに失敗しました");
  }
}

export async function PUT(req: NextRequest, context: Context) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { name } = await context.params;
  const body = (await req.json().catch(() => null)) as { content?: unknown } | null;
  if (typeof body?.content !== "string") {
    return NextResponse.json(
      { error: "content を文字列で指定してください" },
      { status: 400 },
    );
  }

  try {
    const file = writeAgentFile(decodeURIComponent(name), body.content);
    return NextResponse.json({ ok: true, file });
  } catch (err) {
    return extensionsErrorResponse(err, "エージェント定義の保存に失敗しました");
  }
}

export async function PATCH(req: NextRequest, context: Context) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { name } = await context.params;
  const parsed = parseEnabledBody(await req.json().catch(() => undefined));
  if ("error" in parsed) return parsed.error;

  try {
    const file = setAgentFileEnabled(decodeURIComponent(name), parsed.enabled);
    return NextResponse.json({ ok: true, file });
  } catch (err) {
    return extensionsErrorResponse(err, "エージェントの切り替えに失敗しました");
  }
}

export async function DELETE(req: NextRequest, context: Context) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { name } = await context.params;
  try {
    deleteAgentFile(decodeURIComponent(name));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return extensionsErrorResponse(err, "エージェント定義の削除に失敗しました");
  }
}
