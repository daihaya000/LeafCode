import { isWorkflowGraphEditEnabled } from "@/lib/workflow-feature";
import {
  isGraphMutationError,
  updateWorkflowGraph,
} from "@/lib/workflow-graph-mutations";
import { getOrMaterializeWorkflowGraph } from "@/lib/workflow-graph-repository";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function graphConflictKind(operations: unknown): "semantic" | "layout" {
  if (!Array.isArray(operations) || operations.length === 0) return "semantic";
  const layoutOperations = new Set(["move_node", "update_node_presentation", "set_viewport"]);
  return operations.every((operation) =>
    Boolean(operation && typeof operation === "object" && "op" in operation && layoutOperations.has(String(operation.op))),
  ) ? "layout" : "semantic";
}

export async function GET(req: Request, context: Ctx) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  const graph = getOrMaterializeWorkflowGraph(id);
  if (!graph) return Response.json({ error: "workflow graph not found" }, { status: 404 });
  return Response.json({ graph });
}

export async function PATCH(req: Request, context: Ctx) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

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
        {
          error: error.message,
          conflictKind: graphConflictKind(body?.operations),
          graph: "latestGraph" in error ? error.latestGraph : undefined,
        },
        { status: 409 },
      );
    }
    if (error.code === "graph_not_found") return Response.json({ error: error.message }, { status: 404 });
    return Response.json({ error: error.message }, { status: 400 });
  }
}
