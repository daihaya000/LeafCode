import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import {
  countUnreadMemoryExtractionRuns,
  listMemoryExtractionRuns,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseBoolean(value: string | null): boolean {
  return value === "1" || value === "true";
}

/** GET /api/memory/extractions?workspace_id=&limit=&unread_only= */
export async function GET(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const workspaceId = req.nextUrl.searchParams.get("workspace_id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id is required" }, { status: 400 });
  }
  const rawLimit = req.nextUrl.searchParams.get("limit");
  const limit = parseLimit(rawLimit);
  if (rawLimit && limit === undefined) {
    return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
  }

  const runs = listMemoryExtractionRuns({
    workspaceId,
    limit,
    unreadOnly: parseBoolean(req.nextUrl.searchParams.get("unread_only")),
  });
  return NextResponse.json({
    runs,
    unreadCount: countUnreadMemoryExtractionRuns(workspaceId),
  });
}
