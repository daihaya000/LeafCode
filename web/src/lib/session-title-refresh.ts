import { getSetting, getWorkspace, listSessionBindings, updateSessionTitle } from "./db";
import { OcError, ocServer } from "./oc-server";
import {
  SESSION_LIST_PATH,
  sessionMessagePath,
  sessionPath,
} from "./opencode-paths";
import { persistProjectSessions } from "./project-session-sync";
import {
  formatTranscriptForTitle,
  latestModelFromMessages,
  sanitizeTitle,
} from "./session-title";
import {
  GENERATION_MODEL_EFFORT_SETTING_KEY,
  GENERATION_MODEL_SETTING_KEY,
} from "./generation-model";
import type { MessageWithParts } from "./types";

const TITLE_INSTRUCTION =
  "以下の会話を要約する、簡潔で人間が読みやすい日本語タイトルを生成してください。" +
  "最大20文字程度。タイトルのみを返し、引用符や説明は不要です。";

const TITLE_TIMEOUT_MS = 60_000;
const TITLE_MAX_ATTEMPTS = 2;

/**
 * セッション全体から会話を要約したタイトルを生成し、OpenCode セッションと
 * DB・プロジェクトマニフェストへ反映する。認証は呼び出し側の責務。
 *
 * ループのスケジューラ（ターン適用ごと）と refresh-title API の両方から
 * 使われる。失敗時は `OcError` を投げ、呼び出し側で吸収する。
 */
export async function refreshSessionTitleForWorkspace(
  workspaceId: string,
  sessionId: string,
): Promise<string> {
  const ws = getWorkspace(workspaceId);
  if (!ws) {
    throw new OcError("workspace not found", 404);
  }
  const bound = listSessionBindings(workspaceId).some(
    (b) => b.opencode_session_id === sessionId,
  );
  if (!bound) {
    throw new OcError("session not found", 404);
  }

  const dir = ws.absolute_path;

  let messages: MessageWithParts[];
  try {
    messages = await ocServer<MessageWithParts[]>(
      dir,
      sessionMessagePath(sessionId),
    );
  } catch (err) {
    throw new OcError(
      err instanceof Error ? err.message : "failed to read session",
      err instanceof OcError ? err.status : 502,
    );
  }

  const transcript = formatTranscriptForTitle(
    Array.isArray(messages) ? messages : [],
  );
  if (!transcript) {
    throw new OcError(
      "この会話にはタイトルを生成できる内容がありません",
      422,
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
    throw err instanceof OcError
      ? err
      : new OcError(
          err instanceof Error ? err.message : "failed to generate title",
          502,
        );
  }

  // Cleanup temp session BEFORE touching the original. Fail hard on cleanup error.
  try {
    if (titleTempId) {
      await ocServer(dir, sessionPath(titleTempId), { method: "DELETE" });
    }
  } catch (err) {
    throw new OcError(
      err instanceof Error ? err.message : "failed to clean up",
      500,
    );
  }

  if (!title) {
    throw new OcError(
      `タイトルを生成できませんでした。モデルが空の応答を返しました。${modelHint}`,
      502,
    );
  }

  // Write to original session, then DB (preserving updated_at), then manifest.
  try {
    await ocServer(dir, sessionPath(sessionId), {
      method: "PATCH",
      body: { title },
    });
  } catch (err) {
    throw new OcError(
      err instanceof Error ? err.message : "failed to update session",
      err instanceof OcError ? err.status : 502,
    );
  }

  try {
    updateSessionTitle(workspaceId, sessionId, title);
    persistProjectSessions(ws.project_id);
  } catch (err) {
    throw new OcError(
      err instanceof Error ? err.message : "failed to persist title",
      500,
    );
  }

  return title;
}
