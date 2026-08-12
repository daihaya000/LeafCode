import { NextRequest, NextResponse } from "next/server";
import {
  listAgentFiles,
  writeAgentFile,
} from "@/lib/opencode-extensions/agent-files";
import { extensionsErrorResponse } from "@/lib/opencode-extensions/http";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  try {
    return NextResponse.json({ files: listAgentFiles() });
  } catch (err) {
    return extensionsErrorResponse(err, "エージェント定義の取得に失敗しました");
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    content?: unknown;
  } | null;
  if (typeof body?.name !== "string" || typeof body?.content !== "string") {
    return NextResponse.json(
      { error: "name と content を文字列で指定してください" },
      { status: 400 },
    );
  }

  try {
    const file = writeAgentFile(body.name.trim(), body.content);
    return NextResponse.json({ ok: true, file });
  } catch (err) {
    return extensionsErrorResponse(err, "エージェント定義の作成に失敗しました");
  }
}
