import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, listSessionBindings } from "@/lib/db";
import { OcError, ocServer } from "@/lib/oc-server";
import { assertSafeOpenCodeSessionId } from "@/lib/opencode-id";
import {
  extractAssistantText,
  formatConversationForPrompt,
  NEXT_ACTION_SYSTEM_INSTRUCTION,
  normalizeSuggestion,
  sanitizePreviousSuggestions,
} from "@/lib/next-action-text";
import type { MessageWithParts } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type RequestBody = {
  sessionId?: unknown;
  model?: unknown;
  agent?: unknown;
  /** Suggestions already shown to the user (sent on regeneration). */
  previousSuggestions?: unknown;
};

/**
 * POST /api/tasks/[id]/next-action
 *
 * Generate a single next-action suggestion from the bound session's visible
 * conversation. The conversation body is fetched server-side; the client
 * never sends it. A temporary OpenCode session with tools disabled is used
 * so the original session is not mutated. The temp session is always
 * deleted in a finally block; deletion failures are logged but do not fail
 * a successful suggestion.
 *
 * On regeneration the client may send `previousSuggestions` (suggestions
 * already displayed); they are sanitized and embedded in the prompt so the
 * model avoids identical or substantially overlapping proposals.
 *
 * Conversation text and secrets are never written to logs or error responses.
 */
export async function POST(req: NextRequest, context: Ctx) {
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
  const model =
    modelInput &&
    typeof modelInput === "object" &&
    typeof (modelInput as Record<string, unknown>).providerID === "string" &&
    typeof (modelInput as Record<string, unknown>).modelID === "string"
      ? {
          providerID: (modelInput as Record<string, string>).providerID,
          modelID: (modelInput as Record<string, string>).modelID,
        }
      : undefined;
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

  const promptText = formatConversationForPrompt(messages, previousSuggestions);
  if (!promptText) {
    return NextResponse.json(
      { error: "conversation has no actionable content" },
      { status: 400 },
    );
  }

  // 2. Create a temporary session in the same workspace.
  let tempId: string | null = null;
  let suggestion = "";
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

    const promptBody: Record<string, unknown> = {
      system: NEXT_ACTION_SYSTEM_INSTRUCTION,
      tools: toolsMap,
      parts: [{ type: "text", text: promptText }],
    };
    if (model) promptBody.model = model;
    if (agent) promptBody.agent = agent;

    // 3. Synchronous prompt call — returns the assistant message inline.
    const result = await ocServer<{
      parts: { type: string; text?: string }[];
    }>(dir, `/session/${tempId}/message`, {
      method: "POST",
      body: promptBody,
      timeoutMs: 60_000,
    });

    const raw = extractAssistantText(result);
    suggestion = normalizeSuggestion(raw);
  } catch (err) {
    // Never expose conversation body or internal error details.
    const status = err instanceof OcError ? err.status : 502;
    return NextResponse.json(
      { error: "failed to generate suggestion" },
      { status },
    );
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

  if (!suggestion) {
    return NextResponse.json(
      { error: "failed to generate suggestion" },
      { status: 502 },
    );
  }

  return NextResponse.json({ suggestion });
}
