import { NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/db";
import { archiveWorkspace } from "@/lib/workspace-service";
import { WorkflowServiceError, assertNoActiveWorkflow } from "@/lib/workflow-service";

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
  try {
    assertNoActiveWorkflow(id);
    await archiveWorkspace(id);
  } catch (error) {
    if (error instanceof WorkflowServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  return NextResponse.json({ ok: true });
}
