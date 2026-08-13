import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { readMasterAgents, writeMasterAgents } from "@/lib/profiles/agents-sync-engine";
import { withReadCache } from "@/lib/http-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  try {
    return withReadCache(NextResponse.json(readMasterAgents()));
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "content は文字列で指定してください" }, { status: 400 });
  }
  const content = (body as { content?: unknown }).content;
  if (typeof content !== "string") {
    return NextResponse.json({ error: "content は文字列で指定してください" }, { status: 400 });
  }
  if (Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024) {
    return NextResponse.json({ error: "AGENTS.mdは2MB以内で指定してください" }, { status: 413 });
  }

  try {
    return NextResponse.json({ ok: true, ...writeMasterAgents(content) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AGENTS.mdの保存に失敗しました" },
      { status: 500 },
    );
  }
}
