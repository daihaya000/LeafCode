import { NextRequest, NextResponse } from "next/server";
import {
  chooseAutoModel,
  classifyPrompt,
  type AutoCandidateProvider,
  type AutoDecision,
} from "@/lib/auto-model";
import { bindSession, touchProjectOpened } from "@/lib/db";
import { isIntelligenceVariant, type IntelligenceVariant } from "@/lib/model-variants";
import { OcError, ocServer } from "@/lib/oc-server";
import { readProviderModelState } from "@/lib/provider-model-state";
import {
  setSessionTaskPermission,
  type TaskPermission,
} from "@/lib/opencode-task-permission";
import { setSessionSkillPermission } from "@/lib/opencode-skill-permission";
import type { SkillPermission } from "@/lib/skill-permission";
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
/** `/provider` shape needed by the Auto selection (variants + capabilities). */
type AutoProviderResponse = {
  all?: { id?: string; models?: AutoCandidateProvider["models"] }[];
  connected?: string[];
};

function isTaskPermission(value: unknown): value is TaskPermission {
  return value === "allow" || value === "deny";
}

function isSkillPermission(value: unknown): value is SkillPermission {
  return value === "allow" || value === "deny";
}

const IMAGE_MIME_RE = /^image\/[a-z0-9.+-]+$/i;
const DATA_URL_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/]+={0,2})$/i;

// Resource limits to prevent memory exhaustion and oversized requests (R28).
const MAX_IMAGE_COUNT = 10;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function parseImageFiles(value: unknown): ImageFile[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_IMAGE_COUNT) return null;

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
    // Check base64 size (approximate: base64 expands by ~33%, so decoded size ≈ 3/4 of encoded length)
    const estimatedSize = (match[2].length * 3) / 4;
    if (estimatedSize > MAX_IMAGE_SIZE_BYTES) return null;

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
      // Prefer the agent's own model when it is configured; otherwise fall back
      // to the model explicitly selected in the request. This lets an
      // image-capable model chosen at request time apply to agents that have no
      // per-agent model, instead of fail-closing on the missing agent model.
      if (configuredAgent?.model?.providerID && configuredAgent.model.modelID) {
        effectiveModel = configuredAgent.model;
      }
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

/**
 * True when the named agent pins its own model. Auto selection is skipped in
 * that case so OpenCode keeps applying the agent model (same precedence as
 * {@link supportsImageInput}). A `/agent` lookup failure is treated as "no
 * pinned model" so Auto still resolves something instead of sending no model.
 */
async function agentHasFixedModel(agentName: string): Promise<boolean> {
  try {
    const agents = await ocServer<AgentResponse>(null, "/agent");
    const configured = agents.find(({ name }) => name === agentName);
    return Boolean(
      configured?.model?.providerID && configured.model.modelID,
    );
  } catch {
    return false;
  }
}

/**
 * Rule-based Auto model selection: classify the raw prompt, then pick the
 * cheapest sufficient model from the connected + enabled set. Returns `null`
 * when no candidate exists (the caller answers 400 before provisioning).
 */
async function resolveAutoModel(
  prompt: string,
  hasImages: boolean,
): Promise<AutoDecision | null> {
  let providers: AutoCandidateProvider[] = [];
  let connected: string[] = [];
  try {
    const data = await ocServer<AutoProviderResponse>(null, "/provider");
    providers = (data.all ?? []).flatMap((provider) =>
      provider.id ? [{ id: provider.id, models: provider.models ?? {} }] : [],
    );
    connected = data.connected ?? [];
  } catch {
    // Provider list unavailable: no candidate can be verified.
    return null;
  }
  return chooseAutoModel({
    providers,
    connected,
    disabled: readProviderModelState().disabled,
    // Slash commands are classified from their raw text (no expansion).
    tier: classifyPrompt(prompt, { hasImages }),
    hasImages,
  });
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
    subagentPermission?: unknown;
    skillPermission?: unknown;
    variant?: unknown;
    files?: unknown;
    auto?: unknown;
  } | null;

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (
    body?.subagentPermission !== undefined &&
    !isTaskPermission(body.subagentPermission)
  ) {
    return NextResponse.json({ error: "invalid task permission" }, { status: 400 });
  }
  if (
    body?.skillPermission !== undefined &&
    !isSkillPermission(body.skillPermission)
  ) {
    return NextResponse.json({ error: "invalid skill permission" }, { status: 400 });
  }
  // Neither subagentPermission nor skillPermission requires `agent`:
  // setSessionTaskPermission / setSessionSkillPermission are session-scoped
  // (PATCH /session/:id), not agent-scoped, so they apply regardless of
  // whether an execution agent was picked on Home. A prior presence check
  // here forced the client to drop these permissions from the request
  // whenever no agent was selected, silently leaving "不許可" without effect
  // on the new session's first prompt. `agent`, when it *is* provided (for
  // prompt/model routing below), still needs to be a valid non-empty string
  // regardless of any permission flag.
  if (
    body?.agent !== undefined &&
    (typeof body.agent !== "string" || !body.agent.trim())
  ) {
    return NextResponse.json({ error: "invalid agent" }, { status: 400 });
  }
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

  // Auto model selection. Every rejection below runs before
  // `provisionWorkspace` so a bad request never leaves an orphan workspace.
  const autoRaw = body?.auto;
  if (autoRaw !== undefined && typeof autoRaw !== "boolean") {
    return NextResponse.json({ error: "invalid auto" }, { status: 400 });
  }
  const auto = autoRaw === true;
  if (auto && (body?.model?.providerID || body?.model?.modelID)) {
    return NextResponse.json(
      { error: "auto and model are mutually exclusive" },
      { status: 400 },
    );
  }
  if (auto && variant) {
    // Auto decides the reasoning effort itself. Clients are not supposed to
    // send one, but the API contract rejects it explicitly.
    return NextResponse.json(
      { error: "variant cannot be set with auto" },
      { status: 400 },
    );
  }

  // From here on the resolved Auto model is indistinguishable from a manually
  // selected one: everything downstream reads `effectiveModel` / `variant`.
  let effectiveModel: ModelReference | undefined = body?.model;
  let autoDecision: AutoDecision | undefined;
  if (auto) {
    const agentName = body?.agent?.trim();
    // An agent with its own model wins over Auto (existing agent precedence):
    // skip the selection entirely and let OpenCode apply the agent model.
    const agentPinsModel = agentName
      ? await agentHasFixedModel(agentName)
      : false;
    if (!agentPinsModel) {
      const decision = await resolveAutoModel(prompt, files.length > 0);
      if (!decision) {
        return NextResponse.json(
          {
            error:
              "Auto で選択可能なモデルがありません。プロバイダ接続とモデル有効化を確認してください。",
          },
          { status: 400 },
        );
      }
      autoDecision = decision;
      effectiveModel = {
        providerID: decision.providerID,
        modelID: decision.modelID,
      };
      variant = decision.variant;
    }
  }

  // Redundant for Auto (candidates were already narrowed to image-capable
  // models) but kept as a second check on the shared code path.
  if (
    files.length > 0 &&
    !(await supportsImageInput(effectiveModel, body?.agent))
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

    // This is deliberately before the first command/prompt: with the task
    // tool allowed, OpenCode creates a child session without ever emitting a
    // pending permission event for TaskView to reject. Apply the deny/allow as
    // a session-scoped ruleset (a config PATCH is ignored by the running
    // engine, which only loads config at startup).
    if (body?.subagentPermission !== undefined) {
      await setSessionTaskPermission(
        workspace.absolute_path,
        session.id,
        body.subagentPermission,
      );
    }
    if (body?.skillPermission !== undefined) {
      await setSessionSkillPermission(
        workspace.absolute_path,
        session.id,
        body.skillPermission,
      );
    }

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
      if (effectiveModel?.providerID && effectiveModel.modelID) {
        commandBody.model = `${effectiveModel.providerID}/${effectiveModel.modelID}`;
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
      if (effectiveModel?.providerID && effectiveModel.modelID) {
        promptBody.model = {
          providerID: effectiveModel.providerID,
          modelID: effectiveModel.modelID,
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
      // Only present when an Auto selection actually ran (not for a manual
      // model, and not when an agent pinned its own model).
      ...(autoDecision ? { autoDecision } : {}),
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
