import { NextRequest, NextResponse } from "next/server";
import { getGoalLoop } from "@/lib/goal-loop";
import { getTask } from "@/lib/task-service";
import { ServiceError, destroyWorkspace } from "@/lib/workspace-service";
import { WorkflowServiceError, assertNoActiveWorkflow } from "@/lib/workflow-service";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest,
  context: { params: Promise<{ id: string }> },) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  const task = await getTask(id);
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  return NextResponse.json({ task, goalLoop: getGoalLoop(id) });
}

/** Cleanup: remove worktree/copy + metadata (Codex's archive equivalent). */
export async function DELETE(req: NextRequest,
  context: { params: Promise<{ id: string }> },) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  try {
    assertNoActiveWorkflow(id);
    await destroyWorkspace(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof WorkflowServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
