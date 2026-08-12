import { NextRequest, NextResponse } from "next/server";
import { getSetting, getWorkspace, listSessionBindings } from "@/lib/db";
import { OcError, ocServer } from "@/lib/oc-server";
import { assertSafeOpenCodeSessionId } from "@/lib/opencode-id";
import {
  extractAssistantText,
  formatConversationForPrompt,
  NEXT_ACTION_SYSTEM_INSTRUCTION,
  normalizeSuggestion,
  sanitizePreviousSuggestions,
  sanitizeSuggestionCount,
} from "@/lib/next-action-text";
import type { MessageWithParts } from "@/lib/types";
import { requireAuthorized } from "@/lib/api-guard";
import { GENERATION_MODEL_SETTING_KEY } from "@/lib/generation-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type RequestBody = {
  sessionId?: unknown;
  model?: unknown;
  agent?: unknown;
  /** How many suggestions to generate (1–3). Validated and clamped server-side. */
  count?: unknown;
  /** Suggestions already shown to the user (sent on regeneration). */
  previousSuggestions?: unknown;
};

/**
 * POST /api/tasks/[id]/next-action
 *
 * Generate next-action suggestion(s) from the bound session's visible
 * conversation. The conversation body is fetched server-side; the client
 * never sends it. A temporary OpenCode session with tools disabled is used
 * so the original session is not mutated. The temp session is always
 * deleted in a finally block; deletion failures are logged but do not fail
 * a successful suggestion.
 *
 * The optional `count` field (1–3, default 1) requests multiple suggestions;
 * it is validated and clamped server-side. Multiple suggestions are produced
 * by sequential prompts within the same temp session, each prompt excluding
 * every previously shown and already-generated suggestion so the batch does
 * not repeat itself. The response always contains `suggestion` (the first
 * one, for backward compatibility with older clients) plus `suggestions`
 * (the full list).
 *
 * On regeneration the client may send `previousSuggestions` (suggestions
 * already displayed); they are sanitized and embedded in the prompt so the
 * model avoids identical or substantially overlapping proposals.
 *
 * Conversation text and secrets are never written to logs or error responses.
 */
export async function POST(req: NextRequest, context: Ctx) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  const ws = getWorkspace(id);
  if (!ws) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as RequestBody | null;
  const sessionId =
    typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 },
    );
  }

  try {
    assertSafeOpenCodeSessionId(sessionId);
  } catch {
    return NextResponse.json(
      { error: "invalid sessionId" },
      { status: 400 },
    );
  }

  const bound = listSessionBindings(id).some(
    (b) => b.opencode_session_id === sessionId,
  );
  if (!bound) {
    return NextResponse.json(
      { error: "session binding not found" },
      { status: 404 },
    );
  }

  const dir = ws.absolute_path;

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
  const agent =
    typeof agentInput === "string" && agentInput.trim()
      ? agentInput.trim()
      : undefined;

  // 1. Fetch the visible conversation from the source session.
  let messages: MessageWithParts[];
  try {
    messages = await ocServer<MessageWithParts[]>(
      dir,
      `/session/${sessionId}/message`,
    );
  } catch (err) {
    return NextResponse.json(
      { error: "failed to read conversation" },
      { status: err instanceof OcError ? err.status : 502 },
    );
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "conversation is empty" },
      { status: 400 },
    );
  }

  // On regeneration the client sends the suggestions already shown, so the
  // prompt can instruct the model to avoid repeating them. Initial generation
  // sends nothing and behaves exactly as before.
  const previousSuggestions = sanitizePreviousSuggestions(
    body?.previousSuggestions,
  );

  // How many suggestions to generate (1–3). Invalid input falls back to the
  // default (1), which behaves exactly like the original single-suggestion
  // flow.
  const count = sanitizeSuggestionCount(body?.count);

  const initialPrompt = formatConversationForPrompt(
    messages,
    previousSuggestions,
  );
  if (!initialPrompt) {
    return NextResponse.json(
      { error: "conversation has no actionable content" },
      { status: 400 },
    );
  }

  // 2. Create a temporary session in the same workspace.
  let tempId: string | null = null;
  const suggestions: string[] = [];
  let lastError: unknown = null;
  try {
    const temp = await ocServer<{ id: string }>(dir, "/session", {
      method: "POST",
      body: { title: "next-action" },
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
      const promptText = formatConversationForPrompt(messages, excluded);
      const promptBody: Record<string, unknown> = {
        system: NEXT_ACTION_SYSTEM_INSTRUCTION,
        tools: toolsMap,
        parts: [{ type: "text", text: promptText }],
      };
      if (model) promptBody.model = model;
      if (agent) promptBody.agent = agent;

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
    // Never expose conversation body or internal error details.
    lastError = err;
  } finally {
    // 4. Always delete the temp session. Log but do not fail on error.
    if (tempId) {
      try {
        await ocServer(dir, `/session/${tempId}`, { method: "DELETE" });
      } catch (err) {
        // Log but do not fail a successful suggestion.
        console.warn(
          "[next-action] failed to delete temp session",
          err instanceof Error ? err.message : "unknown",
        );
      }
    }
  }

  if (suggestions.length === 0) {
    const status = lastError instanceof OcError ? lastError.status : 502;
    return NextResponse.json(
      { error: "failed to generate suggestion" },
      { status },
    );
  }

  // `suggestion` (first entry) keeps the legacy single-suggestion response
  // shape working for older clients; `suggestions` carries the full list.
  return NextResponse.json({ suggestion: suggestions[0], suggestions });
}
