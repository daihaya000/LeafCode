import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { deleteAllMemories } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PurgeBody = { workspaceId?: unknown; confirm?: unknown };

/**
 * POST /api/memory/purge — delete every memory in one project scope.
 *
 * `confirm: true` is required so a bulk delete can only come from a caller that
 * meant to send one; there is no undo. Purging stays available while the memory
 * layer is switched off, because cleaning up is a reason to switch it off.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as PurgeBody | null;
  if (!body || typeof body.workspaceId !== "string" || body.workspaceId.length === 0) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  if (body.confirm !== true) {
    return NextResponse.json({ error: "confirm must be true" }, { status: 400 });
  }

  const result = deleteAllMemories({ workspaceId: body.workspaceId });
  return NextResponse.json(result);
}
