import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { isMemoryKind, listMemories } from "@/lib/memory";

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
  const workspaceId = searchParams.get("workspace_id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id is required" }, { status: 400 });
  }
  const approved = parseApproved(searchParams.get("approved"));
  const kindParam = searchParams.get("kind");
  const kind = kindParam && isMemoryKind(kindParam) ? kindParam : undefined;

  const memories = listMemories({ workspaceId, approved, kind });
  return NextResponse.json({ memories });
}
