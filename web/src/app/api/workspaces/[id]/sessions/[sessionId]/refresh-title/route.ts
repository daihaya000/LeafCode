import { NextRequest, NextResponse } from "next/server";
import { getSetting, getWorkspace, listSessionBindings, updateSessionTitle } from "@/lib/db";
import { OcError, ocServer } from "@/lib/oc-server";
import {
  SESSION_LIST_PATH,
  sessionMessagePath,
  sessionPath,
} from "@/lib/opencode-paths";
import { persistProjectSessions } from "@/lib/project-session-sync";
import {
  formatTranscriptForTitle,
  latestModelFromMessages,
  sanitizeTitle,
} from "@/lib/session-title";
import type { MessageWithParts } from "@/lib/types";
import { requireAuthorized } from "@/lib/api-guard";
import { GENERATION_MODEL_EFFORT_SETTING_KEY, GENERATION_MODEL_SETTING_KEY } from "@/lib/generation-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; sessionId: string }> };

const TITLE_INSTRUCTION =
  "以下の会話を要約する、簡潔で人間が読みやすい日本語タイトルを生成してください。" +
  "最大20文字程度。タイトルのみを返し、引用符や説明は不要です。";

const TITLE_TIMEOUT_MS = 60_000;
const TITLE_MAX_ATTEMPTS = 2;

export async function POST(req: NextRequest, context: Ctx) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id, sessionId } = await context.params;
  const ws = getWorkspace(id);
  if (!ws) {
    return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  }
  const bound = listSessionBindings(id).some(
    (b) => b.opencode_session_id === sessionId,
  );
  if (!bound) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  const dir = ws.absolute_path;

  let messages: MessageWithParts[];
  try {
    messages = await ocServer<MessageWithParts[]>(
      dir,
      sessionMessagePath(sessionId),
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to read session" },
      { status: err instanceof OcError ? err.status : 502 },
    );
  }

  const transcript = formatTranscriptForTitle(
    Array.isArray(messages) ? messages : [],
  );
  if (!transcript) {
    return NextResponse.json(
      { error: "この会話にはタイトルを生成できる内容がありません" },
      { status: 422 },
    );
  }
  const configuredModel = getSetting(GENERATION_MODEL_SETTING_KEY);
  const model = configuredModel
    ? (() => {
        const [providerID, modelID] = configuredModel.split("::");
        return { providerID, modelID };
      })()
    : latestModelFromMessages(messages);
  // Paired reasoning effort for the configured generation model.
  const configuredEffort = configuredModel
    ? getSetting(GENERATION_MODEL_EFFORT_SETTING_KEY) || undefined
    : undefined;
  // When neither the setting nor the conversation resolved a model, the
  // engine falls back to its default — that is a common failure cause.
  const modelHint = model
    ? ""
    : "（生成モデルが未設定のため、エンジンのデフォルトモデルに依存しました。設定タブで生成モデルを指定すると安定します）";

  // Generate via a temporary unbound session so the original stays clean.
  // Timeouts (408) are retried once with a fresh temp session.
  let title = "";
  let titleTempId: string | null = null;
  try {
    for (let attempt = 1; attempt <= TITLE_MAX_ATTEMPTS; attempt++) {
      let tempId: string | null = null;
      try {
        const temp = await ocServer<{ id: string }>(dir, SESSION_LIST_PATH, {
          method: "POST",
          body: { title: "title-gen" },
        });
        tempId = temp.id;

        // Explicitly disable every tool; without a complete ID list this is not fail-closed.
        let ids: unknown;
        try {
          ids = await ocServer<unknown>(dir, "/experimental/tool/ids");
        } catch {
          throw new Error("failed to read a non-empty tool ID list");
        }
        if (!Array.isArray(ids) || ids.length === 0) {
          throw new Error("failed to read a non-empty tool ID list");
        }
        const toolIds = ids as string[];
        const toolsMap: Record<string, boolean> = {};
        for (const toolId of toolIds) toolsMap[toolId] = false;

        const promptBody: Record<string, unknown> = {
          system: TITLE_INSTRUCTION,
          tools: toolsMap,
          parts: [{ type: "text", text: transcript }],
        };
        if (model) promptBody.model = model;
        if (configuredEffort) promptBody.variant = configuredEffort;

        const result = await ocServer<
          { parts: { type: string; text?: string }[] }
        >(
          dir,
          sessionMessagePath(tempId),
          { method: "POST", body: promptBody, timeoutMs: TITLE_TIMEOUT_MS },
        ).catch((err) => {
          // Keep 408 intact so the retry below can recognize a timeout.
          if (err instanceof OcError && err.status === 408) throw err;
          throw new OcError(
            `${err instanceof Error ? err.message : "failed to generate title"}${modelHint}`,
            err instanceof OcError ? err.status : 502,
          );
        });
        const raw = (result.parts ?? [])
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text!)
          .join("\n");
        title = sanitizeTitle(raw);
        titleTempId = tempId;
        break;
      } catch (err) {
        if (tempId) {
          await ocServer(dir, sessionPath(tempId), { method: "DELETE" }).catch(
            () => undefined,
          );
        }
        const isTimeout =
          err instanceof OcError && err.status === 408;
        if (isTimeout && attempt < TITLE_MAX_ATTEMPTS) {
          // Retry with a fresh temp session; the timed-out one is gone.
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "failed to generate title",
      },
      { status: err instanceof OcError ? err.status : 502 },
    );
  }

  // Cleanup temp session BEFORE touching the original. Fail hard on cleanup error.
  try {
    if (titleTempId) {
      await ocServer(dir, sessionPath(titleTempId), { method: "DELETE" });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to clean up" },
      { status: 500 },
    );
  }

  if (!title) {
    return NextResponse.json(
      {
        error: `タイトルを生成できませんでした。モデルが空の応答を返しました。${modelHint}`,
      },
      { status: 502 },
    );
  }

  // Write to original session, then DB (preserving updated_at), then manifest.
  try {
    await ocServer(dir, sessionPath(sessionId), {
      method: "PATCH",
      body: { title },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "failed to update session",
      },
      { status: err instanceof OcError ? err.status : 502 },
    );
  }

  try {
    updateSessionTitle(id, sessionId, title);
    persistProjectSessions(ws.project_id);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to persist title" },
      { status: 500 },
    );
  }

  return NextResponse.json({ title });
}
