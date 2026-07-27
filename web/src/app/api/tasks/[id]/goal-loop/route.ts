import { NextRequest, NextResponse } from "next/server";
import {
  createGoalLoop,
  getGoalLoop,
  updateGoalLoopMaxTurns,
  updateGoalLoopStatus,
} from "@/lib/goal-loop";
import { OcError } from "@/lib/oc-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: Ctx) {
  const { id } = await context.params;
  return NextResponse.json({ loop: getGoalLoop(id) });
}

export async function POST(req: NextRequest, context: Ctx) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => null)) as {
    sessionId?: unknown;
    goal?: unknown;
    acceptance?: unknown;
    maxTurns?: unknown;
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
  const loop = await updateGoalLoopStatus(id, action);
  if (!loop) {
    return NextResponse.json({ error: "goal loop not found" }, { status: 404 });
  }
  return NextResponse.json({ loop });
}
