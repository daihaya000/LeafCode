import { NextRequest, NextResponse } from "next/server";
import { bindSession, getDb, getWorkspace } from "@/lib/db";
import { assertSafeOpenCodeSessionId } from "@/lib/opencode-id";
import { persistProjectSessions } from "@/lib/project-session-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: Ctx) {
  const { id } = await context.params;
  const ws = getWorkspace(id);
  if (!ws) {
    return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  }
  const rows = getDb()
    .prepare(
      `SELECT workspace_id, opencode_session_id, title, updated_at
       FROM session_bindings WHERE workspace_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(id) as {
    workspace_id: string;
    opencode_session_id: string;
    title: string;
    updated_at: string;
  }[];

  return NextResponse.json({
    sessions: rows.map((r) => ({
      workspaceId: r.workspace_id,
      opencodeSessionId: r.opencode_session_id,
      title: r.title,
      updatedAt: r.updated_at,
    })),
  });
}

export async function POST(req: NextRequest, context: Ctx) {
  const { id } = await context.params;
  const ws = getWorkspace(id);
  if (!ws) {
    return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    opencodeSessionId?: string;
    title?: string;
  } | null;

  if (!body?.opencodeSessionId) {
    return NextResponse.json(
      { error: "opencodeSessionId is required" },
      { status: 400 },
    );
  }

  try {
    assertSafeOpenCodeSessionId(body.opencodeSessionId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid opencodeSessionId" },
      { status: 400 },
    );
  }

  bindSession(id, body.opencodeSessionId, body.title?.trim() || "Session");
  persistProjectSessions(ws.project_id);
  return NextResponse.json({ ok: true });
}
