import { NextRequest, NextResponse } from "next/server";
import { isWorkflowModeEnabled } from "@/lib/workflow-feature";
import { retryWorkflowNode, WorkflowServiceError } from "@/lib/workflow-service";
import { isWorkflowNodeKey } from "@/lib/workflow-types";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; nodeKey: string }> };

export async function POST(req: NextRequest, context: Ctx) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id, nodeKey: rawNodeKey } = await context.params;
  if (!isWorkflowModeEnabled()) {
    return NextResponse.json({ error: "Workflow mode is disabled" }, { status: 409 });
  }
  if (!isWorkflowNodeKey(rawNodeKey)) {
    return NextResponse.json({ error: "unknown workflow node" }, { status: 400 });
  }
  const body = (await req.json().catch(() => null)) as { workflowRevision?: unknown } | null;
  try {
    return NextResponse.json({
      workflow: retryWorkflowNode({
        workspaceId: id,
        nodeKey: rawNodeKey,
        workflowRevision: body?.workflowRevision,
      }),
    });
  } catch (error) {
    if (error instanceof WorkflowServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
