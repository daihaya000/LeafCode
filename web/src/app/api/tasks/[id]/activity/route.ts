import { NextRequest, NextResponse } from "next/server";

import { getWorkspace, touchSessionActivity } from "@/lib/db";
import { assertSafeOpenCodeSessionId } from "@/lib/opencode-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Ctx) {
  const { id } = await context.params;
  if (!getWorkspace(id)) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    sessionId?: unknown;
  } | null;
  if (typeof body?.sessionId !== "string" || !body.sessionId) {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 },
    );
  }

  try {
    assertSafeOpenCodeSessionId(body.sessionId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid sessionId" },
      { status: 400 },
    );
  }

  if (!touchSessionActivity(id, body.sessionId)) {
    return NextResponse.json(
      { error: "session binding not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
