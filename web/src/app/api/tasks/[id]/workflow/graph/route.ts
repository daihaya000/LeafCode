import { isWorkflowGraphEditEnabled } from "@/lib/workflow-feature";
import {
  isGraphMutationError,
  updateWorkflowGraph,
} from "@/lib/workflow-graph-mutations";
import { getOrMaterializeWorkflowGraph } from "@/lib/workflow-graph-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: Ctx) {
  const { id } = await context.params;
  const graph = getOrMaterializeWorkflowGraph(id);
  if (!graph) return Response.json({ error: "workflow graph not found" }, { status: 404 });
  return Response.json({ graph });
}

export async function PATCH(req: Request, context: Ctx) {
  const { id } = await context.params;
  if (!isWorkflowGraphEditEnabled()) {
    return Response.json({ error: "Workflow Graph editing is disabled" }, { status: 409 });
  }
  const body = (await req.json().catch(() => null)) as {
    expectedGraphRevision?: unknown;
    operations?: unknown;
  } | null;
  try {
    const graph = updateWorkflowGraph({
      workspaceId: id,
      expectedGraphRevision: body?.expectedGraphRevision,
      operations: body?.operations,
    });
    return Response.json({ graph });
  } catch (error) {
    if (!isGraphMutationError(error)) throw error;
    if (error.code === "revision_conflict") {
      return Response.json(
        { error: error.message, graph: "latestGraph" in error ? error.latestGraph : undefined },
        { status: 409 },
      );
    }
    if (error.code === "graph_not_found") return Response.json({ error: error.message }, { status: 404 });
    return Response.json({ error: error.message }, { status: 400 });
  }
}
