import { NextRequest, NextResponse } from "next/server";
import { bindSession, touchProjectOpened } from "@/lib/db";
import { isIntelligenceVariant } from "@/lib/model-variants";
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

type ImageFile = { uri: string; mime: string; name?: string };

const IMAGE_MIME_RE = /^image\/[a-z0-9.+-]+$/i;
const DATA_URL_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/]+={0,2})$/i;

function parseImageFiles(value: unknown): ImageFile[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const files: ImageFile[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const { uri, mime, name } = entry as Record<string, unknown>;
    if (typeof uri !== "string" || typeof mime !== "string" || !IMAGE_MIME_RE.test(mime)) {
      return null;
    }
    const match = DATA_URL_RE.exec(uri);
    if (
      !match ||
      match[2].length % 4 !== 0 ||
      match[1].toLowerCase() !== mime.toLowerCase() ||
      (name !== undefined && typeof name !== "string")
    ) {
      return null;
    }
    files.push({ uri, mime, ...(name ? { name } : {}) });
  }
  return files;
}

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
    variant?: unknown;
    files?: unknown;
  } | null;

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const files = parseImageFiles(body?.files);
  if (files === null) {
    return NextResponse.json({ error: "invalid files" }, { status: 400 });
  }
  if (!body?.projectId || (!prompt && files.length === 0)) {
    return NextResponse.json(
      { error: "projectId and prompt or files are required" },
      { status: 400 },
    );
  }
  const isolation = body.isolation ?? "git_worktree";
  if (!isIsolation(isolation)) {
    return NextResponse.json({ error: "invalid isolation" }, { status: 400 });
  }

  // Validate the optional intelligence variant before provisioning any
  // workspace. Only "high" and "low" are supported; any other non-empty
  // value is rejected. An empty string is treated as "default" (omitted).
  const variantRaw = body?.variant;
  let variant: "high" | "low" | "";
  if (variantRaw === undefined || variantRaw === "") {
    variant = "";
  } else if (typeof variantRaw === "string" && isIntelligenceVariant(variantRaw)) {
    variant = variantRaw;
  } else {
    return NextResponse.json(
      { error: "invalid variant" },
      { status: 400 },
    );
  }

  const title =
    (typeof body.title === "string" ? body.title.trim() : "") ||
    (prompt
      ? prompt.replace(/\s+/g, " ").slice(0, 48) + (prompt.length > 48 ? "…" : "")
      : "画像タスク");

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
      parts: [
        { type: "text", text: prompt },
        ...files.map((file) => ({
          type: "file",
          url: file.uri,
          mime: file.mime,
          ...(file.name ? { filename: file.name } : {}),
        })),
      ],
    };
    if (body.model?.providerID && body.model.modelID) {
      promptBody.model = {
        providerID: body.model.providerID,
        modelID: body.model.modelID,
      };
    }
    if (body.agent?.trim()) promptBody.agent = body.agent.trim();
    if (variant) promptBody.variant = variant;
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
