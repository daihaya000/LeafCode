import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import {
  countUnreadMemoryExtractionRuns,
  markMemoryExtractionRunsRead,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReadBody = { workspaceId?: unknown };

/** POST /api/memory/extractions/read — mark one workspace's history as read. */
export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as ReadBody | null;
  if (!body || typeof body.workspaceId !== "string" || body.workspaceId.length === 0) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const marked = markMemoryExtractionRunsRead(body.workspaceId);
  return NextResponse.json({
    marked,
    unreadCount: countUnreadMemoryExtractionRuns(body.workspaceId),
  });
}
