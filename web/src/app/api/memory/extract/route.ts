import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { runMemoryExtraction } from "@/lib/memory-extract";
import { getWorkspace } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExtractBody = { workspaceId?: unknown; sessionId?: unknown };

/** POST /api/memory/extract  — manual extraction for one session. */
export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as ExtractBody | null;
  if (
    !body ||
    typeof body !== "object" ||
    typeof body.workspaceId !== "string" ||
    typeof body.sessionId !== "string"
  ) {
    return NextResponse.json({ error: "workspaceId and sessionId are required" }, { status: 400 });
  }
  const workspace = getWorkspace(body.workspaceId);
  if (!workspace) {
    return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  }
  const result = await runMemoryExtraction({
    workspaceId: body.workspaceId,
    sessionId: body.sessionId,
  });
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ result });
}