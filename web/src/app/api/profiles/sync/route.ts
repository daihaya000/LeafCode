import { NextResponse } from "next/server";
import { readSyncStatus, planSync, applySync } from "@/lib/profiles/sync-engine";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  try {
    const status = readSyncStatus();
    const plan = planSync();
    return NextResponse.json({
      status,
      plan: plan.ok
        ? {
            ok: true,
            masterServers: plan.masterServers,
            targets: plan.targets,
          }
        : { ok: false, error: plan.error },
    });
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
    const result = applySync();
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "同期の実行に失敗しました" },
      { status: 500 },
    );
  }
}