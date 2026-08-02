import { getWorkflow } from "@/lib/workflow-service";
import { saveWorkflowArtifact, validateWorkflowArtifact, type WorkflowArtifactOrigin } from "@/lib/workflow-artifacts";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: Ctx): Promise<Response> {
  const { id } = await context.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const workflow = getWorkflow(id);
  if (!workflow?.run) return Response.json({ error: "workflow not found" }, { status: 404 });
  if (typeof body?.workflowRevision !== "number" || body.workflowRevision !== workflow.run.revision) return Response.json({ error: "workflow revision conflict" }, { status: 409 });
  const input = {
    workflowRunId: workflow.run.id,
    nodeAttemptId: typeof body.attemptId === "string" ? body.attemptId : undefined,
    kind: "screenshot" as const,
    label: typeof body.label === "string" ? body.label : "Visual Judge screenshot",
    opaqueRef: typeof body.opaqueRef === "string" ? body.opaqueRef : "",
    origin: body.origin as WorkflowArtifactOrigin,
    expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
    metadata: body.metadata && typeof body.metadata === "object" ? body.metadata as { tabId?: string; origin?: string; sourceId?: string } : undefined,
  };
  if (!["task_attachment", "shared_tab", "browser_bridge"].includes(input.origin)) return Response.json({ error: "invalid artifact origin" }, { status: 400 });
  try {
    validateWorkflowArtifact(input);
    const artifactId = saveWorkflowArtifact(input);
    return Response.json({ artifactId, workflowRevision: workflow.run.revision }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "invalid artifact" }, { status: 400 });
  }
}
