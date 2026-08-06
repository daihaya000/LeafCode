import { NextResponse } from "next/server";
import { rejectUnlessLocalOrAuthenticated } from "@/lib/local-request";
import { readAgentsSyncStatus, applyAgentsSync } from "@/lib/profiles/agents-sync-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await rejectUnlessLocalOrAuthenticated(req);
  if (denied) return denied;

  try {
    return NextResponse.json(readAgentsSyncStatus());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "同期状況の取得に失敗しました" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const denied = await rejectUnlessLocalOrAuthenticated(req);
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
