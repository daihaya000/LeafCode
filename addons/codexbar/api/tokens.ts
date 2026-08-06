import { NextRequest, NextResponse } from "next/server";
import { aggregateCodexTokens } from "../lib/codex-tokens-server";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const raw = Number(req.nextUrl.searchParams.get("days"));
  const days =
    Number.isFinite(raw) && raw >= 1 && raw <= 90 ? Math.floor(raw) : 1;
  try {
    return NextResponse.json(await aggregateCodexTokens(days));
  } catch {
    return NextResponse.json(
      {
        available: false,
        reason: "トークン集計に失敗しました",
        days,
        sessions: 0,
        totals: {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
        },
        generatedAt: new Date().toISOString(),
      },
      { status: 200 },
    );
  }
}
