import { NextRequest, NextResponse } from "next/server";
import { isWorkflowModeEnabled } from "@/lib/workflow-feature";
import { runWorkflowSchedulerTick } from "@/lib/workflow-scheduler";
import { requireAuthorized } from "@/lib/api-guard";
import {
  createWorkflow,
  getWorkflow,
  reattachWorkflow,
  updateWorkflow,
  type WorkflowAction,
  WorkflowServiceError,
} from "@/lib/workflow-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function errorResponse(error: unknown): NextResponse {
  if (error instanceof WorkflowServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}

export async function GET(req: NextRequest, context: Ctx) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  const workflow = getWorkflow(id);
  if (!workflow) return NextResponse.json({ error: "task not found" }, { status: 404 });
  return NextResponse.json({ workflow });
}

export async function POST(req: NextRequest, context: Ctx) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  if (!isWorkflowModeEnabled()) {
    return NextResponse.json({ error: "Workflow mode is disabled" }, { status: 409 });
  }
  const body = (await req.json().catch(() => null)) as {
    workspaceRevision?: unknown;
    taskContext?: unknown;
    goal?: unknown;
    acceptance?: unknown;
    constraints?: unknown;
  } | null;
  const taskContext =
    body?.taskContext ??
    (body
      ? {
          goal: body.goal,
          acceptance: body.acceptance,
          constraints: body.constraints,
        }
      : null);
  try {
    const workflow = createWorkflow({
      workspaceId: id,
      workspaceRevision: body?.workspaceRevision,
      taskContext,
    });
    return NextResponse.json({ workflow }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: NextRequest, context: Ctx) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  const body = (await req.json().catch(() => null)) as {
    action?: unknown;
    workflowRevision?: unknown;
    workspaceRevision?: unknown;
    primarySessionId?: unknown;
    workflowRunId?: unknown;
  } | null;
  const action = body?.action;
  if (action === "reattach") {
    if (!isWorkflowModeEnabled()) {
      return NextResponse.json({ error: "Workflow mode is disabled" }, { status: 409 });
    }
    try {
      const workflow = reattachWorkflow({
        workspaceId: id,
        workflowRunId: body?.workflowRunId,
        workspaceRevision: body?.workspaceRevision,
      });
      return NextResponse.json({ workflow });
    } catch (error) {
      return errorResponse(error);
    }
  }
  if (
    action !== "start" &&
    action !== "pause" &&
    action !== "resume" &&
    action !== "stop" &&
    action !== "detach"
  ) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }
  if ((action === "start" || action === "resume") && !isWorkflowModeEnabled()) {
    return NextResponse.json({ error: "Workflow mode is disabled" }, { status: 409 });
  }
  try {
    const workflow = updateWorkflow({
      workspaceId: id,
      action: action as WorkflowAction,
      workflowRevision: body?.workflowRevision,
      workspaceRevision: body?.workspaceRevision,
      primarySessionId: body?.primarySessionId,
    });
    if (action === "start" || action === "resume") void runWorkflowSchedulerTick();
    return NextResponse.json({ workflow });
  } catch (error) {
    return errorResponse(error);
  }
}
