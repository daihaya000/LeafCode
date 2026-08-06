import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { isMemoryKind, listMemories } from "@/lib/memory";
import { runMemoryExtraction } from "@/lib/memory-extract";
import { getWorkspace } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseApproved(value: string | null): boolean | undefined {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return undefined;
}

/** GET /api/memory?workspace_id=&approved=&kind=  — memory list. */
export async function GET(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { searchParams } = req.nextUrl;
  const workspaceId = searchParams.get("workspace_id") ?? undefined;
  const approved = parseApproved(searchParams.get("approved"));
  const kindParam = searchParams.get("kind");
  const kind = kindParam && isMemoryKind(kindParam) ? kindParam : undefined;

  const memories = listMemories({ workspaceId, approved, kind });
  return NextResponse.json({ memories });
}

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