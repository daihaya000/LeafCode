import { NextRequest, NextResponse } from "next/server";
import { bindSession, touchProjectOpened } from "@/lib/db";
import { OcError, ocServer } from "@/lib/oc-server";
import { persistProjectSessions } from "@/lib/project-session-sync";
import { listTasks } from "@/lib/task-service";
import {
  ServiceError,
  destroyWorkspace,
  isIsolation,
  provisionWorkspace,
} from "@/lib/workspace-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await listTasks();
  return NextResponse.json(result);
}

/** Create workspace + session + fire the first prompt, in one action. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    projectId?: string;
    prompt?: string;
    isolation?: string;
    baseBranch?: string;
    title?: string;
    model?: { providerID?: string; modelID?: string };
    agent?: string;
  } | null;

  const prompt = body?.prompt?.trim();
  if (!body?.projectId || !prompt) {
    return NextResponse.json(
      { error: "projectId and prompt are required" },
      { status: 400 },
    );
  }
  const isolation = body.isolation ?? "git_worktree";
  if (!isIsolation(isolation)) {
    return NextResponse.json({ error: "invalid isolation" }, { status: 400 });
  }

  const title =
    body.title?.trim() ||
    prompt.replace(/\s+/g, " ").slice(0, 48) + (prompt.length > 48 ? "…" : "");

  let workspace;
  let note: string | undefined;
  try {
    const result = await provisionWorkspace({
      projectId: body.projectId,
      displayName: title,
      isolation,
      baseBranch: body.baseBranch,
    });
    workspace = result.workspace;
    note = result.note;
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  try {
    const session = await ocServer<{ id: string }>(
      workspace.absolute_path,
      "/session",
      { method: "POST", body: { title } },
    );
    const promptBody: Record<string, unknown> = {
      parts: [{ type: "text", text: prompt }],
    };
    if (body.model?.providerID && body.model.modelID) {
      promptBody.model = {
        providerID: body.model.providerID,
        modelID: body.model.modelID,
      };
    }
    if (body.agent?.trim()) promptBody.agent = body.agent.trim();
    await ocServer(
      workspace.absolute_path,
      `/session/${session.id}/prompt_async`,
      { method: "POST", body: promptBody },
    );
    bindSession(workspace.id, session.id, title);
    touchProjectOpened(workspace.project_id);
    persistProjectSessions(workspace.project_id);
    return NextResponse.json({
      taskId: workspace.id,
      sessionId: session.id,
      directory: workspace.absolute_path,
      note,
    });
  } catch (err) {
    // Roll back the freshly provisioned workspace so no orphan remains
    await destroyWorkspace(workspace.id).catch(() => undefined);
    const status = err instanceof OcError && err.status === 503 ? 503 : 502;
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "failed to start OpenCode session",
      },
      { status },
    );
  }
}
