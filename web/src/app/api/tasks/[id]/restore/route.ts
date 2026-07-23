import { NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/db";
import { restoreWorkspace } from "@/lib/workspace-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const ws = getWorkspace(id);
  if (!ws || ws.status !== "archived") {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  await restoreWorkspace(id);
  return NextResponse.json({ ok: true });
}
