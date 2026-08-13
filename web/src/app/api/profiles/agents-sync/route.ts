import { NextResponse } from "next/server";
import { readAgentsSyncStatus, applyAgentsSync } from "@/lib/profiles/agents-sync-engine";
import { requireAuthorized } from "@/lib/api-guard";
import { withReadCache } from "@/lib/http-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  try {
    return withReadCache(NextResponse.json(readAgentsSyncStatus()));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "同期状況の取得に失敗しました" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  try {
    const result = applyAgentsSync();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "同期の実行に失敗しました" },
      { status: 500 },
    );
  }
}
