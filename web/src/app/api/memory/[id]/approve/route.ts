import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { approveMemory, logMemoryAudit } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/memory/:id/approve — accept an auto-extracted candidate. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "invalid memory id" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { workspaceId?: unknown } | null;
  if (typeof body?.workspaceId !== "string" || !body.workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const approved = approveMemory(id, body.workspaceId);
  if (!approved) {
    return NextResponse.json({ error: "memory not found" }, { status: 404 });
  }
  logMemoryAudit("approve", { memoryId: id, workspaceId: approved.workspaceId });
  return NextResponse.json({ memory: approved });
}
