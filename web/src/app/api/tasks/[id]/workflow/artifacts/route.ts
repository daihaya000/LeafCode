import { getWorkflow } from "@/lib/workflow-service";
import { BrowserBridgeArtifactError, saveWorkflowArtifact, validateWorkflowArtifact, verifyBrowserBridgeScreenshot, type WorkflowArtifactOrigin } from "@/lib/workflow-artifacts";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: Ctx): Promise<Response> {
  const { id } = await context.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const workflow = getWorkflow(id);
  if (!workflow?.run) return Response.json({ error: "workflow not found" }, { status: 404 });
  if (typeof body?.workflowRevision !== "number" || body.workflowRevision !== workflow.run.revision) return Response.json({ error: "workflow revision conflict" }, { status: 409 });
  if (typeof body.attemptId !== "string") return Response.json({ error: "attemptId is required" }, { status: 400 });
  const attempt = getDb().prepare(
    `SELECT n.node_key FROM workflow_node_attempts a JOIN workflow_node_runs n ON n.id = a.node_run_id
     WHERE a.id = ? AND n.workflow_run_id = ?`,
  ).get(body.attemptId, workflow.run.id) as { node_key: string } | undefined;
  if (!attempt || attempt.node_key !== "visual_judge") return Response.json({ error: "artifact must belong to Visual Judge" }, { status: 409 });
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
    if (input.origin === "browser_bridge") {
      const tabId = input.metadata?.tabId;
      if (!tabId) return Response.json({ error: "Browser Bridge tabId is required" }, { status: 400 });
      const tab = await verifyBrowserBridgeScreenshot({ tabId, opaqueRef: input.opaqueRef, expectedOrigin: input.metadata?.origin });
      input.metadata = { ...input.metadata, origin: tab.origin };
      input.label = input.label === "Visual Judge screenshot" ? tab.title : input.label;
    }
    validateWorkflowArtifact(input);
    const artifactId = saveWorkflowArtifact(input);
    return Response.json({ artifactId, workflowRevision: workflow.run.revision }, { status: 201 });
  } catch (error) {
    if (error instanceof BrowserBridgeArtifactError) return Response.json({ error: error.message, code: error.code, state: error.state }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : "invalid artifact" }, { status: 400 });
  }
}
