import { NextResponse } from "next/server";
import { OPENCODE_BASE_URL } from "@/lib/opencode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => undefined)) as { key?: unknown } | undefined;
  if (typeof body?.key !== "string" || body.key.trim().length === 0 || body.key.length > 4096) {
    return NextResponse.json({ error: "Cursor APIキーを入力してください" }, { status: 400 });
  }

  try {
    const upstream = await fetch(new URL("/auth/cursor-acp", OPENCODE_BASE_URL), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "api", key: body.key }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = await upstream.json().catch(() => undefined);
    if (!upstream.ok || result !== true) {
      return NextResponse.json({ error: "Cursor APIキーを保存できません" }, { status: upstream.ok ? 502 : upstream.status });
    }
    return NextResponse.json({ ok: true, requiresRestart: true });
  } catch {
    return NextResponse.json({ error: "Cursor APIキーの保存に失敗しました" }, { status: 503 });
  }
}

export async function DELETE() {
  try {
    const upstream = await fetch(new URL("/auth/cursor-acp", OPENCODE_BASE_URL), {
      method: "DELETE",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = await upstream.json().catch(() => undefined);
    if (!upstream.ok || result !== true) {
      return NextResponse.json({ error: "Cursor認証を解除できません" }, { status: upstream.ok ? 502 : upstream.status });
    }
    return NextResponse.json({ ok: true, requiresRestart: true });
  } catch {
    return NextResponse.json({ error: "Cursor認証の解除に失敗しました" }, { status: 503 });
  }
}
