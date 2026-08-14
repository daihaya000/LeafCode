import { NextRequest, NextResponse } from "next/server";
import { getProject, getSetting, listWorkspaces } from "@/lib/db";
import { OcError, ocServer } from "@/lib/oc-server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { gitBranchRefs, gitDiff, gitLogGraph, gitStatus } from "@/lib/git";
import {
  extractAssistantText,
  normalizeSuggestion,
  sanitizePreviousSuggestions,
  sanitizeSuggestionCount,
} from "@/lib/next-action-text";
import {
  formatRepoSnapshotForPrompt,
  NEXT_TASK_COMMIT_MAX_COUNT,
  NEXT_TASK_RECENT_TASK_MAX_COUNT,
  NEXT_TASK_SYSTEM_INSTRUCTION,
  type RepoCommit,
} from "@/lib/next-task-text";
import { requireAuthorized } from "@/lib/api-guard";
import {
  GENERATION_MODEL_EFFORT_SETTING_KEY,
  GENERATION_MODEL_SETTING_KEY,
} from "@/lib/generation-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type RequestBody = {
  model?: unknown;
  agent?: unknown;
  /** How many suggestions to generate (1–3). Validated and clamped server-side. */
  count?: unknown;
  /** Suggestions already shown to the user (sent on regeneration). */
  previousSuggestions?: unknown;
};

/**
 * POST /api/projects/[id]/next-task
 *
 * Generate "next task to start" suggestion(s) for a project from its
 * repository state. Home has no session, so — unlike
 * /api/tasks/[id]/next-action — there is no conversation to read. The
 * repository snapshot (branch, `git status --short`, pending diff, recent
 * commits) plus the project's recent task names is gathered server-side; the
 * client never sends it.
 *
 * A temporary OpenCode session with every tool disabled is used so nothing in
 * the project can be mutated. The temp session is always deleted in a finally
 * block; deletion failures are logged but do not fail a successful suggestion.
 *
 * `count` (1–3, default 1) requests multiple suggestions, produced by
 * sequential prompts in the same temp session, each excluding everything
 * already shown or generated so the batch never repeats itself. The response
 * contains `suggestion` (the first one) plus `suggestions` (the full list),
 * matching the next-action response shape.
 *
 * Repository contents and secrets are never written to logs or error responses.
 */
export async function POST(req: NextRequest, context: Ctx) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  // The project root is user-supplied data; run it through the same allowlist
  // guard the git routes use before handing it to git or OpenCode.
  const check = assertAllowedDirectory(project.root_path);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  const dir = check.path;

  const body = (await req.json().catch(() => null)) as RequestBody | null;

  // Optional model/agent pass-through from the composer.
  const modelInput = body?.model;
  const agentInput = body?.agent;
  const requestModel =
    modelInput &&
    typeof modelInput === "object" &&
    typeof (modelInput as Record<string, unknown>).providerID === "string" &&
    typeof (modelInput as Record<string, unknown>).modelID === "string"
      ? {
          providerID: (modelInput as Record<string, string>).providerID,
          modelID: (modelInput as Record<string, string>).modelID,
        }
      : undefined;
  const configuredModel = getSetting(GENERATION_MODEL_SETTING_KEY);
  const model = configuredModel
    ? (() => {
        const [providerID, modelID] = configuredModel.split("::");
        return { providerID, modelID };
      })()
    : requestModel;
  // Paired reasoning effort for the configured generation model.
  const configuredEffort = configuredModel
    ? getSetting(GENERATION_MODEL_EFFORT_SETTING_KEY) || undefined
    : undefined;
  const agent =
    typeof agentInput === "string" && agentInput.trim()
      ? agentInput.trim()
      : undefined;

  // 1. Gather the repository snapshot. A project root that is not a git
  // repository (or a git failure) is not fatal: those sections are simply
  // omitted and the recent-task list can still carry the proposal.
  const [status, diff, commits, currentBranch] = await Promise.all([
    gitStatus(dir).catch(() => ""),
    gitDiff(dir).catch(() => ""),
    gitLogGraph(dir, NEXT_TASK_COMMIT_MAX_COUNT)
      .then(({ commits: list }): RepoCommit[] =>
        list.map((c) => ({ shortHash: c.shortHash, subject: c.subject })),
      )
      .catch((): RepoCommit[] => []),
    gitBranchRefs(dir)
      .then(({ currentBranch: branch }) => branch)
      .catch(() => null),
  ]);

  const recentTasks = listWorkspaces(project.id)
    .slice(0, NEXT_TASK_RECENT_TASK_MAX_COUNT)
    .map((w) => w.display_name);

  const previousSuggestions = sanitizePreviousSuggestions(
    body?.previousSuggestions,
  );
  const count = sanitizeSuggestionCount(body?.count);

  const snapshot = {
    projectName: project.name,
    currentBranch,
    status,
    diff,
    commits,
    recentTasks,
  };

  if (!formatRepoSnapshotForPrompt(snapshot, previousSuggestions)) {
    return NextResponse.json(
      { error: "repository has no actionable state" },
      { status: 400 },
    );
  }

  // 2. Create a temporary session in the project directory.
  let tempId: string | null = null;
  const suggestions: string[] = [];
  let lastError: unknown = null;
  try {
    const temp = await ocServer<{ id: string }>(dir, "/session", {
      method: "POST",
      body: { title: "next-task" },
    });
    tempId = temp.id;

    // Disable every tool so the temp session cannot mutate anything.
    let ids: unknown;
    try {
      ids = await ocServer<unknown>(dir, "/experimental/tool/ids");
    } catch {
      throw new Error("failed to read tool ids");
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error("failed to read tool ids");
    }
    const toolsMap: Record<string, boolean> = {};
    for (const toolId of ids as string[]) toolsMap[toolId] = false;

    // 3. Sequential synchronous prompt calls — one per requested suggestion.
    // Each prompt excludes the previously shown suggestions AND everything
    // already generated in this batch, so the batch never repeats itself.
    const excluded = [...previousSuggestions];
    for (let i = 0; i < count; i++) {
      const promptText = formatRepoSnapshotForPrompt(snapshot, excluded);
      const promptBody: Record<string, unknown> = {
        system: NEXT_TASK_SYSTEM_INSTRUCTION,
        tools: toolsMap,
        parts: [{ type: "text", text: promptText }],
      };
      if (model) promptBody.model = model;
      if (agent) promptBody.agent = agent;
      if (configuredEffort) promptBody.variant = configuredEffort;

      try {
        const result = await ocServer<{
          parts: { type: string; text?: string }[];
        }>(dir, `/session/${tempId}/message`, {
          method: "POST",
          body: promptBody,
          timeoutMs: 60_000,
        });
        const s = normalizeSuggestion(extractAssistantText(result));
        // Skip empty outputs and exact duplicates of excluded/earlier ones.
        if (s && !excluded.includes(s)) {
          suggestions.push(s);
          excluded.push(s);
        }
      } catch (err) {
        // Keep whatever was generated so far; stop requesting more.
        lastError = err;
        break;
      }
    }
  } catch (err) {
    // Never expose repository contents or internal error details.
    lastError = err;
  } finally {
    // 4. Always delete the temp session. Log but do not fail on error.
    if (tempId) {
      try {
        await ocServer(dir, `/session/${tempId}`, { method: "DELETE" });
      } catch (err) {
        console.warn(
          "[next-task] failed to delete temp session",
          err instanceof Error ? err.message : "unknown",
        );
      }
    }
  }

  if (suggestions.length === 0) {
    // Named httpStatus so it does not shadow the git status string above.
    const httpStatus = lastError instanceof OcError ? lastError.status : 502;
    return NextResponse.json(
      { error: "failed to generate suggestion" },
      { status: httpStatus },
    );
  }

  return NextResponse.json({ suggestion: suggestions[0], suggestions });
}
