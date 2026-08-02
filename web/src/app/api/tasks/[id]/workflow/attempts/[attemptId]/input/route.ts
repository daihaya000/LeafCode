import { pauseWorkflowForManualInput, WorkflowServiceError } from "@/lib/workflow-service";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string; attemptId: string }> };

export async function POST(req: Request, context: Ctx): Promise<Response> {
  const { id, attemptId } = await context.params;
  const body = (await req.json().catch(() => null)) as { prompt?: unknown; command?: unknown; workflowRevision?: unknown } | null;
  const hasInput = (typeof body?.prompt === "string" && body.prompt.trim().length > 0) || (typeof body?.command === "string" && body.command.trim().length > 0);
  if (!hasInput) return Response.json({ error: "prompt or command is required" }, { status: 400 });
  try {
    const workflow = pauseWorkflowForManualInput({ workspaceId: id, attemptId, workflowRevision: body?.workflowRevision });
    return Response.json({ error: "manual input is not allowed while Workflow is running", workflow }, { status: 409 });
  } catch (error) {
    if (error instanceof WorkflowServiceError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
