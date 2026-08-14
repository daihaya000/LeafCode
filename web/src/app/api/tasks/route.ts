import { NextRequest, NextResponse } from "next/server";
import {
  chooseAutoModel,
  classifyPrompt,
  DEFAULT_AUTO_OPTIMIZE_MODE,
  isAutoOptimizeMode,
  normalizeAutoRouteConfig,
  type AutoCandidateProvider,
  type AutoDecision,
  type AutoOptimizeMode,
  type AutoProviderUsage,
  type AutoRouteConfig,
} from "@/lib/auto-model";
import { bindSession, touchProjectOpened } from "@/lib/db";
import { armHangWatch, disarmHangWatch } from "@/lib/hang-watchdog";
import { isIntelligenceVariant, type IntelligenceVariant } from "@/lib/model-variants";
import { OcError, ocServer } from "@/lib/oc-server";
import { readProviderModelState } from "@/lib/provider-model-state";
import {
  setSessionTaskPermission,
  type TaskPermission,
} from "@/lib/opencode-task-permission";
import { setSessionSkillPermission } from "@/lib/opencode-skill-permission";
import type { SkillPermission } from "@/lib/skill-permission";
import { setSessionEditPermission } from "@/lib/opencode-access-mode";
import type { AccessMode } from "@/lib/access-mode";
import { persistProjectSessions } from "@/lib/project-session-sync";
import {
  normalizeCommands,
  parseCommandSubmit,
} from "@/lib/slash-command";
import { listTasks } from "@/lib/task-service";
import { requireAuthorized } from "@/lib/api-guard";
import { SESSION_PROMPT_ASYNC_TIMEOUT_MS } from "@/lib/image-send-timeout";
import {
  analyzeNativeImages,
  isQwenNativeVisionAvailable,
  nativeImageContext,
  retainForDisplay,
} from "@/lib/qwen-native-vision";
import {
  ServiceError,
  destroyWorkspace,
  isIsolation,
  provisionWorkspace,
} from "@/lib/workspace-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Numeric literal required: Next.js rejects imported segment config.
// Keep in sync with IMAGE_SEND_ROUTE_MAX_DURATION_SEC.
export const maxDuration = 640;

/**
 * Resume timeouts stored on the hang watch for this task's first turn. They
 * mirror the BFF upstream budgets (`UPSTREAM_TIMEOUT_MS` /
 * `LONG_RUNNING_UPSTREAM_TIMEOUT_MS`) and must be passed to `ocServer` —
 * the implicit 10s default aborts a slow engine accept or slash command.
 */
const SESSION_PROMPT_TIMEOUT_MS = SESSION_PROMPT_ASYNC_TIMEOUT_MS;
const SESSION_COMMAND_TIMEOUT_MS = 290_000;

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

function isAccessMode(value: unknown): value is AccessMode {
  return value === "ask" || value === "full";
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
      providers.connected !== undefined &&
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
  files: readonly unknown[],
  mode: AutoOptimizeMode,
  usage?: AutoProviderUsage,
  config?: AutoRouteConfig,
): Promise<AutoDecision | null> {
  const hasImages = files.length > 0;
  // `/provider` fetch failures propagate to the caller (as `OcError` or a
  // generic `Error`) instead of collapsing into a `null` return here. `null`
  // is reserved for "the fetch succeeded but no candidate survived
  // filtering" — the caller answers each case with a different message, and
  // conflating them previously told users to check provider/model settings
  // even when the real problem was OpenCode being unreachable.
  const data = await ocServer<AutoProviderResponse>(null, "/provider");
  const providers: AutoCandidateProvider[] = (data.all ?? []).flatMap(
    (provider) =>
      provider.id ? [{ id: provider.id, models: provider.models ?? {} }] : [],
  );
  const connected = data.connected;
  return chooseAutoModel({
    providers,
    connected,
    disabled: readProviderModelState().disabled,
    // Slash commands are classified from their raw text (no expansion).
    // A brand-new session has no history and no prior failure, so the only
    // context signal available here is the attachment count.
    tier: classifyPrompt(prompt, {
      hasImages,
      attachmentCount: files.length,
    }),
    mode,
    hasImages,
    config,
    usage,
  });
}

function parseCodexBarUsage(value: unknown): AutoProviderUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const usage: AutoProviderUsage = {};
  for (const [providerID, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const usedPercent = entry.usedPercent;
    if (
      (usedPercent !== null &&
        (typeof usedPercent !== "number" || !Number.isFinite(usedPercent))) ||
      typeof entry.limited !== "boolean"
    ) {
      continue;
    }
    usage[providerID] = { usedPercent: usedPercent as number | null, limited: entry.limited };
  }
  return Object.keys(usage).length > 0 ? usage : undefined;
}

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const result = await listTasks();
  return NextResponse.json(result);
}

/** Create workspace + session + fire the first prompt, in one action. */
export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

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
    accessMode?: unknown;
    variant?: unknown;
    files?: unknown;
    auto?: unknown;
    autoOptimize?: unknown;
    autoRouteOverrides?: unknown;
    codexBarUsage?: unknown;
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
  if (body?.accessMode !== undefined && !isAccessMode(body.accessMode)) {
    return NextResponse.json({ error: "invalid access mode" }, { status: 400 });
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
  // "Optimize For" policy. Absent means the default (cost); a value without
  // `auto` is a client bug worth surfacing rather than silently ignoring.
  const autoOptimizeRaw = body?.autoOptimize;
  let autoOptimize = DEFAULT_AUTO_OPTIMIZE_MODE;
  if (autoOptimizeRaw !== undefined) {
    if (!auto) {
      return NextResponse.json(
        { error: "autoOptimize requires auto" },
        { status: 400 },
      );
    }
    if (!isAutoOptimizeMode(autoOptimizeRaw)) {
      return NextResponse.json(
        { error: "invalid autoOptimize" },
        { status: 400 },
      );
    }
    autoOptimize = autoOptimizeRaw;
  }
  // Per-tier routing config. Absent means "use the preset for the mode".
  // Any JSON shape is accepted; unknown tiers/entries are dropped by
  // normalizeAutoRouteConfig so a corrupted payload never blocks routing.
  let autoRouteConfig: AutoRouteConfig | undefined;
  if (body?.autoRouteOverrides !== undefined) {
    if (!auto) {
      return NextResponse.json(
        { error: "autoRouteOverrides requires auto" },
        { status: 400 },
      );
    }
    autoRouteConfig = normalizeAutoRouteConfig(body.autoRouteOverrides);
  }
  const codexBarUsage = auto ? parseCodexBarUsage(body?.codexBarUsage) : undefined;

  // When local Qwen vision is enabled, Auto can choose a text-only model and
  // the image will be converted to analysis text after provisioning.
  const qwenNativeForAuto = auto && files.length > 0 && isQwenNativeVisionAvailable();

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
      let decision: AutoDecision | null;
      try {
        decision = await resolveAutoModel(
          prompt,
          qwenNativeForAuto ? [] : files,
          autoOptimize,
          codexBarUsage,
          autoRouteConfig,
        );
      } catch (err) {
        // The provider list itself could not be fetched (OpenCode
        // unreachable/timed out/errored) — distinct from "fetched fine but
        // no candidate survived filtering" below. Retrying later is the
        // right fix here, not touching provider/model settings.
        return NextResponse.json(
          {
            error:
              "OpenCode のプロバイダ情報を取得できませんでした。しばらくしてから再試行してください。",
          },
          { status: err instanceof OcError && err.status === 503 ? 503 : 502 },
        );
      }
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
  let qwenNativeFallback = false;
  if (files.length > 0 && !(await supportsImageInput(effectiveModel, body?.agent))) {
    qwenNativeFallback = isQwenNativeVisionAvailable();
    if (!qwenNativeFallback) {
      return NextResponse.json(
        {
          error:
            "選択中のモデルは画像入力に対応しておらず、画像事前解析も有効ではありません。画像対応モデルを選ぶか、設定の「プロバイダー/モデル」タブで画像事前解析モデルを選択してください。",
        },
        { status: 400 },
      );
    }
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
      // A task without an explicit selection executes as the built-in build
      // agent. Isolated workspaces receive only this task's identity, never
      // the user's repository-wide Git configuration.
      agentName: body.agent?.trim() || "build",
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

    const qwenImages = files.map((file) => ({
      dataUrl: file.uri,
      mime: file.mime,
    }));
    let promptForSend = prompt;
    if (qwenNativeFallback) {
      const analysis = await analyzeNativeImages(prompt, qwenImages, workspace.absolute_path);
      // The file parts are dropped from the send below, so keep display copies.
      promptForSend = nativeImageContext(prompt, analysis, retainForDisplay(qwenImages));
    }

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
    // Same reason, for file writes: OpenCode's default ruleset allows `edit`
    // outright, so without this rule the very first prompt could apply_patch /
    // write with no permission event — no approval card, even in 確認する.
    if (body?.accessMode !== undefined) {
      await setSessionEditPermission(
        workspace.absolute_path,
        session.id,
        body.accessMode,
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
      if (qwenNativeFallback) {
        commandBody.parts = [{ type: "text", text: promptForSend }];
      } else if (files.length > 0) {
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
      // The first turn of a new task is fired here, not through the BFF proxy,
      // so it has to arm the hang watchdog itself.
      // See docs/specs/hang-watchdog-server-side.md.
      armHangWatch({
        sessionId: session.id,
        directory: workspace.absolute_path,
        requestPath: `/session/${session.id}/command`,
        body: commandBody,
        timeoutMs: SESSION_COMMAND_TIMEOUT_MS,
      });
      await ocServer(
        workspace.absolute_path,
        `/session/${session.id}/command`,
        {
          method: "POST",
          body: commandBody,
          timeoutMs: SESSION_COMMAND_TIMEOUT_MS,
        },
      );
      // The synchronous command endpoint returns only after the turn finishes.
      // Do not leave a completed, possibly textless command under the hang
      // watchdog.
      disarmHangWatch(session.id);
    } else {
      const promptBody: Record<string, unknown> = {
        parts: [
          { type: "text", text: promptForSend },
          ...(qwenNativeFallback
            ? []
            : files.map((file) => ({
                type: "file",
                url: file.uri,
                mime: file.mime,
                ...(file.name ? { filename: file.name } : {}),
              }))),
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
      // Same as the command branch: arm before the send so a first turn that
      // hangs is still stopped and resumed once.
      armHangWatch({
        sessionId: session.id,
        directory: workspace.absolute_path,
        requestPath: `/session/${session.id}/prompt_async`,
        body: promptBody,
        timeoutMs: SESSION_PROMPT_TIMEOUT_MS,
      });
      await ocServer(
        workspace.absolute_path,
        `/session/${session.id}/prompt_async`,
        {
          method: "POST",
          body: promptBody,
          timeoutMs: SESSION_PROMPT_TIMEOUT_MS,
        },
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
      disarmHangWatch(createdSessionId);
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
