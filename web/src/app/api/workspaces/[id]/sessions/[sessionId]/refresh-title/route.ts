import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, listSessionBindings, updateSessionTitle } from "@/lib/db";
import { OcError, ocServer } from "@/lib/oc-server";
import { persistProjectSessions } from "@/lib/project-session-sync";
import {
  buildTranscript,
  latestModelFromMessages,
  sanitizeTitle,
} from "@/lib/session-title";
import type { MessageWithParts } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; sessionId: string }> };

const TITLE_INSTRUCTION =
  "以下の会話を要約する、簡潔で人間が読みやすい日本語タイトルを生成してください。" +
  "最大20文字程度。タイトルのみを返し、引用符や説明は不要です。";

export async function POST(_req: NextRequest, context: Ctx) {
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
      `/session/${sessionId}/message`,
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to read session" },
      { status: err instanceof OcError ? err.status : 502 },
    );
  }

  const transcript = buildTranscript(Array.isArray(messages) ? messages : []);
  if (!transcript.trim()) {
    return NextResponse.json(
      { error: "この会話にはタイトルを生成できる内容がありません" },
      { status: 422 },
    );
  }
  const model = latestModelFromMessages(messages);

  // Generate via a temporary unbound session so the original stays clean.
  let tempId: string | null = null;
  let title = "";
  try {
    const temp = await ocServer<{ id: string }>(dir, "/session", {
      method: "POST",
      body: { title: "title-gen" },
    });
    tempId = temp.id;

    // Explicitly disable every tool; an empty tools object is not fail-closed.
    let toolIds: string[] = [];
    try {
      const ids = await ocServer<string[]>(dir, "/experimental/tool/ids");
      toolIds = Array.isArray(ids) ? ids : [];
    } catch {
      toolIds = ["bash", "edit", "read", "write", "glob", "grep", "task", "webfetch"];
    }
    const toolsMap: Record<string, boolean> = {};
    for (const toolId of toolIds) toolsMap[toolId] = false;
    if (Object.keys(toolsMap).length === 0) toolsMap.bash = false;

    const promptBody: Record<string, unknown> = {
      system: TITLE_INSTRUCTION,
      tools: toolsMap,
      parts: [{ type: "text", text: transcript }],
    };
    if (model) promptBody.model = model;

    const result = await ocServer<{ parts: { type: string; text?: string }[] }>(
      dir,
      `/session/${tempId}/message`,
      { method: "POST", body: promptBody, timeoutMs: 30_000 },
    );
    const raw = (result.parts ?? [])
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!)
      .join("\n");
    title = sanitizeTitle(raw);
  } catch (err) {
    if (tempId)
      await ocServer(dir, `/session/${tempId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to generate title" },
      { status: err instanceof OcError ? err.status : 502 },
    );
  }

  // Cleanup temp session BEFORE touching the original. Fail hard on cleanup error.
  try {
    if (tempId) await ocServer(dir, `/session/${tempId}`, { method: "DELETE" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to clean up" },
      { status: 500 },
    );
  }

  if (!title) {
    return NextResponse.json(
      { error: "タイトルを生成できませんでした" },
      { status: 502 },
    );
  }

  // Write to original session, then DB (preserving updated_at), then manifest.
  try {
    await ocServer(dir, `/session/${sessionId}`, {
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
