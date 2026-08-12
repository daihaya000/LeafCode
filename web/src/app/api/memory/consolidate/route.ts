import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { consolidateDuplicateMemories, logMemoryAudit } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConsolidateBody = { workspaceId?: unknown; dryRun?: unknown };

/**
 * POST /api/memory/consolidate — collapse pre-existing near-duplicates.
 *
 * `dryRun` defaults to true: the caller has to ask explicitly for deletion, so a
 * mistaken request can never destroy memories.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as ConsolidateBody | null;
  if (!body || typeof body.workspaceId !== "string" || body.workspaceId.length === 0) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const dryRun = body.dryRun !== false;

  const result = consolidateDuplicateMemories({
    workspaceId: body.workspaceId,
    dryRun,
  });
  if (!dryRun) {
    logMemoryAudit("delete", {
      workspaceId: body.workspaceId,
      detail: `consolidate removed=${result.removed} remaining=${result.remaining}`,
    });
  }
  return NextResponse.json(result);
}
