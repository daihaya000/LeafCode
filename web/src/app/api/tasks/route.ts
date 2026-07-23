import { NextRequest, NextResponse } from "next/server";
import { bindSession, touchProjectOpened } from "@/lib/db";
import { isIntelligenceVariant, type IntelligenceVariant } from "@/lib/model-variants";
import { OcError, ocServer } from "@/lib/oc-server";
import { persistProjectSessions } from "@/lib/project-session-sync";
import {
  normalizeCommands,
  parseCommandSubmit,
} from "@/lib/slash-command";
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
type ModelReference = { providerID?: string; modelID?: string };
type ProviderResponse = {
  all?: {
    id?: string;
    models?: Record<
      string,
      {
        capabilities?: {
          attachment?: boolean;
          input?: { image?: boolean };
        };
      }
    >;
  }[];
  connected?: string[];
};
type AgentResponse = {
  name?: string;
  model?: ModelReference;
}[];

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

async function supportsImageInput(
  model: ModelReference | undefined,
  agent: string | undefined,
): Promise<boolean> {
  try {
    let effectiveModel = model;
    const agentName = agent?.trim();
    if (agentName) {
      const agents = await ocServer<AgentResponse>(null, "/agent");
      const configuredAgent = agents.find(({ name }) => name === agentName);
      if (
        !configuredAgent?.model?.providerID ||
        !configuredAgent.model.modelID
      ) {
        return false;
      }
      effectiveModel = configuredAgent.model;
    }
    if (!effectiveModel?.providerID || !effectiveModel.modelID) return false;

    const providers = await ocServer<ProviderResponse>(null, "/provider");
    if (
      providers.connected?.length &&
      !providers.connected.includes(effectiveModel.providerID)
    ) {
      return false;
    }
    const capabilities = providers.all
      ?.find((provider) => provider.id === effectiveModel.providerID)
      ?.models?.[effectiveModel.modelID]?.capabilities;
    return (
      capabilities?.input?.image === true || capabilities?.attachment === true
    );
  } catch {
    return false;
  }
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
  // workspace. Known effort keys (none/minimal/low/medium/high/xhigh/max/
  // thinking) are accepted; any other non-empty value is rejected. An empty
  // string is treated as "default" (omitted from the OpenCode payload).
  const variantRaw = body?.variant;
  let variant: IntelligenceVariant | "";
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

  if (
    files.length > 0 &&
    !(await supportsImageInput(body?.model, body?.agent))
  ) {
    return NextResponse.json(
      {
        error:
          "選択中のモデルは画像入力に対応していないか、画像対応を確認できません。",
      },
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

  let createdSessionId: string | undefined;
  try {
    const session = await ocServer<{ id: string }>(
      workspace.absolute_path,
      "/session",
      { method: "POST", body: { title } },
    );
    createdSessionId = session.id;
    // Bind before prompt so create-failure rollback can delete the OpenCode
    // session via destroyWorkspace (bindings are the only id source there).
    bindSession(workspace.id, session.id, title);

    const commandList = await ocServer<unknown>(
      workspace.absolute_path,
      "/command",
    ).catch(() => []);
    const parsedCommand = parseCommandSubmit(
      prompt,
      normalizeCommands(commandList),
    );

    if (parsedCommand) {
      const commandBody: Record<string, unknown> = {
        command: parsedCommand.command,
        arguments: parsedCommand.arguments,
      };
      if (files.length > 0) {
        commandBody.parts = files.map((file) => ({
          type: "file",
          url: file.uri,
          mime: file.mime,
          ...(file.name ? { filename: file.name } : {}),
        }));
      }
      if (body.model?.providerID && body.model.modelID) {
        commandBody.model = `${body.model.providerID}/${body.model.modelID}`;
      }
      if (body.agent?.trim()) commandBody.agent = body.agent.trim();
      if (variant) commandBody.variant = variant;
      await ocServer(
        workspace.absolute_path,
        `/session/${session.id}/command`,
        { method: "POST", body: commandBody },
      );
    } else {
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
    }
    touchProjectOpened(workspace.project_id);
    persistProjectSessions(workspace.project_id);
    return NextResponse.json({
      taskId: workspace.id,
      sessionId: session.id,
      directory: workspace.absolute_path,
      note,
    });
  } catch (err) {
    // Roll back the freshly provisioned workspace so no orphan remains.
    // If bind never ran, still best-effort delete the OpenCode session.
    if (createdSessionId) {
      await ocServer(
        workspace.absolute_path,
        `/session/${createdSessionId}`,
        { method: "DELETE" },
      ).catch(() => undefined);
    }
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
