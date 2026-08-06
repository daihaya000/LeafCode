import { NextResponse } from "next/server";
import { activate } from "@/lib/profiles/service";
import { applySync } from "@/lib/profiles/sync-engine";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request,
  { params }: { params: Promise<{ id: string }> },) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await params;
  const result = activate(id);

  if ("status" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  let syncResult: ReturnType<typeof applySync> | undefined;
  let syncError: string | undefined;
  try {
    syncResult = applySync();
  } catch (err) {
    syncError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({ ok: true, sync: syncResult, syncError });
}
