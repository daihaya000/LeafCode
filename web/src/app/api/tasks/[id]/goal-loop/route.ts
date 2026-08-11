import { NextRequest, NextResponse } from "next/server";
import {
  createGoalLoop,
  getGoalLoop,
  updateGoalLoopMaxTurns,
  updateGoalLoopStatus,
} from "@/lib/goal-loop";
import { OcError } from "@/lib/oc-server";
import { workspaceHasActiveWorkflow } from "@/lib/workflow-service";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Ctx) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  return NextResponse.json({ loop: getGoalLoop(id) });
}

export async function POST(req: NextRequest, context: Ctx) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  if (workspaceHasActiveWorkflow(id)) {
    return NextResponse.json(
      { error: "Goal Loop cannot run while Workflow is active" },
      { status: 409 },
    );
  }
  const body = (await req.json().catch(() => null)) as {
    sessionId?: unknown;
    goal?: unknown;
    acceptance?: unknown;
    maxTurns?: unknown;
    forceFullRun?: unknown;
    agent?: unknown;
    model?: unknown;
    variant?: unknown;
  } | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const goal = typeof body?.goal === "string" ? body.goal : "";
  try {
    const loop = await createGoalLoop({
      workspaceId: id,
      sessionId,
      goal,
      acceptance: body?.acceptance,
      maxTurns: body?.maxTurns,
      forceFullRun: body?.forceFullRun,
      agent: body?.agent,
      model: body?.model,
      variant: body?.variant,
    });
    return NextResponse.json({ loop });
  } catch (err) {
    if (err instanceof OcError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export async function PATCH(req: NextRequest, context: Ctx) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  const body = (await req.json().catch(() => null)) as
    | { action?: unknown; maxTurns?: unknown }
    | null;
  const action = body?.action;
  if (action === "updateMaxTurns") {
    try {
      const loop = updateGoalLoopMaxTurns(id, body?.maxTurns);
      if (!loop) {
        return NextResponse.json({ error: "goal loop not found" }, { status: 404 });
      }
      return NextResponse.json({ loop });
    } catch (err) {
      if (err instanceof OcError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
  }
  if (action !== "pause" && action !== "resume" && action !== "stop") {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }
  if (action === "resume" && workspaceHasActiveWorkflow(id)) {
    return NextResponse.json(
      { error: "Goal Loop cannot resume while Workflow is active" },
      { status: 409 },
    );
  }
  const loop = await updateGoalLoopStatus(id, action);
  if (!loop) {
    return NextResponse.json({ error: "goal loop not found" }, { status: 404 });
  }
  return NextResponse.json({ loop });
}
