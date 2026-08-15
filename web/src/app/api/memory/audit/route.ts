import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { listMemoryAuditLog } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/memory/audit?workspace_id=&limit= — memory audit trail (newest first). */
export async function GET(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { searchParams } = req.nextUrl;
  const workspaceId = searchParams.get("workspace_id");
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const entries = listMemoryAuditLog({
    workspaceId: workspaceId ?? undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
  return NextResponse.json({ entries });
}
