import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { readMasterAgents, writeMasterAgents } from "@/lib/profiles/agents-sync-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  try {
    return NextResponse.json(readMasterAgents());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AGENTS.mdの読み込みに失敗しました" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  let body: { content?: unknown };
  try {
    body = (await req.json()) as { content?: unknown };
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content は文字列で指定してください" }, { status: 400 });
  }
  if (Buffer.byteLength(body.content, "utf8") > 2 * 1024 * 1024) {
    return NextResponse.json({ error: "AGENTS.mdは2MB以内で指定してください" }, { status: 413 });
  }

  try {
    return NextResponse.json({ ok: true, ...writeMasterAgents(body.content) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AGENTS.mdの保存に失敗しました" },
      { status: 500 },
    );
  }
}
