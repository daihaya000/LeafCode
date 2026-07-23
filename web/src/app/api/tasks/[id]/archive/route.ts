import { NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/db";
import { archiveWorkspace } from "@/lib/workspace-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const ws = getWorkspace(id);
  if (!ws) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  if (ws.status === "merging") {
    return NextResponse.json(
      { error: "cannot archive a merging task" },
      { status: 409 },
    );
  }
  await archiveWorkspace(id);
  return NextResponse.json({ ok: true });
}
