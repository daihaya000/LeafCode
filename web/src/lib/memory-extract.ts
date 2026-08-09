/**
 * Memory auto-extraction (docs/specs/memory-layer.md 「自動抽出」).
 *
 * Reads the tail of a source session's transcript, runs a lightweight model in a
 * throwaway OpenCode session, parses the fenced-JSON result, and inserts
 * `approved=0` candidates. Pure helpers are unit-tested; the network driver is
 * intentionally a thin wrapper over the existing `ocServer` path used by the
 * goal loop (POST /session + prompt_async + transcript poll + DELETE).
 */

import { getWorkspace, type WorkspaceRow } from "./db";
import { insertExtractedMemories, logMemoryAudit, type MemoryDto } from "./memory";
import { chooseAutoModel, type AutoDecision } from "./auto-model";
import { OcError, ocServer } from "./oc-server";
import {
  SESSION_LIST_PATH,
  sessionPath,
  sessionMessagePath,
  sessionPromptAsyncPath,
} from "./opencode-paths";
import type { MessageWithParts } from "./types";

export const MEMORY_EXTRACT_TRANSCRIPT_MAX_CHARS = 16_000;
export const MEMORY_EXTRACT_RESULT_TIMEOUT_MS = 120_000;
export const MEMORY_EXTRACT_POLL_MS = 2_000;

export type ExtractionResult = {
  created: number;
  skipped: number;
  errors: string[];
  /** Set only when the whole run failed before inserting anything. */
  error?: string;
};

type ExtractionModel = Pick<AutoDecision, "providerID" | "modelID" | "variant">;

export function buildExtractionSessionBody(model: ExtractionModel | null) {
  return {
    title: "memory-extract",
    ...(model
      ? {
          model: {
            providerID: model.providerID,
            id: model.modelID,
            variant: model.variant || undefined,
          },
        }
      : {}),
  };
}

/** Join a message's text parts into plain text. */
export function messageText(message: MessageWithParts): string {
  return (message.parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

/** Join the transcript and keep only the tail (`maxChars`). */
export function extractTranscriptTail(
  messages: MessageWithParts[],
  maxChars: number = MEMORY_EXTRACT_TRANSCRIPT_MAX_CHARS,
): string {
  const text = messages.map(messageText).filter(Boolean).join("\n");
  return text.length <= maxChars ? text : text.slice(text.length - maxChars);
}

/** Pull the last fenced ```json ... ``` block out of a reply. */
export function lastJsonBlock(text: string): string | null {
  const matches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1]?.trim() ?? null;
}

const EXTRACTION_JSON_SCHEMA = {
  memories: [
    {
      kind: "fact | preference | lesson | reference",
      content: "string",
    },
  ],
};

/**
 * Parse the structured extraction reply. Any non-JSON or structurally invalid
 * reply returns null so the caller can retry once / fail cleanly.
 */
export function parseExtractionJson(
  text: string,
): Array<{ kind: string; content: string }> | null {
  const block = lastJsonBlock(text);
  if (!block) return null;
  try {
    const parsed = JSON.parse(block) as { memories?: unknown };
    if (!Array.isArray(parsed.memories)) return null;
    const items = parsed.memories.filter(
      (item): item is { kind: string; content: string } => {
        const value = item as { kind?: unknown; content?: unknown };
        return (
          value !== null &&
          typeof value === "object" &&
          typeof value.kind === "string" &&
          typeof value.content === "string"
        );
      },
    );
    return items;
  } catch {
    return null;
  }
}

export function buildExtractionPrompt(transcript: string): string {
  return `<!-- webui-memory-extract -->

Extract durable, reusable facts about this project and its working conventions from the transcript below. Output ONLY a single fenced JSON block:

\`\`\`json
${JSON.stringify(EXTRACTION_JSON_SCHEMA, null, 2)}
\`\`\`

Rules:
- kinds: fact (project structure / commands), preference (user conventions), lesson (gotchas / pitfalls learned), reference (URLs, names, versions worth remembering).
- Do NOT quote code or file contents. Only generally-applicable propositions.
- 1-2 items is normal. Skip trivia and one-off remarks.
- If nothing is worth keeping, output {"memories": []}.
- Write nothing after the closing fence.

TRANSCRIPT (tail):
${transcript}`;
}

/**
 * Best-effort lightweight model for extraction: the cheapest model that still
 * fits a short extraction prompt. Falls back to `null` (engine default) when
 * the provider list is unavailable.
 */
export async function resolveLightweightModel(
  directory: string,
): Promise<Pick<AutoDecision, "providerID" | "modelID" | "variant"> | null> {
  let providers: unknown;
  try {
    providers = await ocServer(directory, "/provider", {
      timeoutMs: 10_000,
    });
  } catch {
    return null;
  }
  const typed = providers as {
    all?: { id?: string; models?: Record<string, unknown> }[];
    connected?: string[];
  };
  const decision = chooseAutoModel({
    providers: (typed.all ?? []) as never,
    connected: typed.connected,
    disabled: {},
    tier: "light",
    mode: "cost",
    hasImages: false,
  });
  if (!decision) return null;
  return {
    providerID: decision.providerID,
    modelID: decision.modelID,
    variant: decision.variant as never,
  };
}

/**
 * Run one extraction for `sourceSessionId` inside `workspaceId`. Inserts
 * approved=0 candidates. Never touches the source transcript (it runs in a
 * throwaway session).
 */
export async function runMemoryExtraction(input: {
  workspaceId: string;
  sessionId: string;
}): Promise<ExtractionResult> {
  const workspace = getWorkspace(input.workspaceId) as WorkspaceRow | undefined;
  if (!workspace) {
    return { created: 0, skipped: 0, errors: [], error: "workspace not found" };
  }
  const directory = workspace.absolute_path;

  let messages: MessageWithParts[];
  try {
    messages = await ocServer<MessageWithParts[]>(
      directory,
      sessionMessagePath(input.sessionId),
      { timeoutMs: 10_000 },
    );
  } catch {
    return {
      created: 0,
      skipped: 0,
      errors: [],
      error: "source session transcript is not readable",
    };
  }
  const transcript = extractTranscriptTail(messages);
  if (transcript.trim().length === 0) {
    return { created: 0, skipped: 0, errors: [], error: "source session is empty" };
  }

  const model = await resolveLightweightModel(directory);

  let sessionID: string | null = null;
  try {
    const created = await ocServer<{ id: string }>(directory, SESSION_LIST_PATH, {
      method: "POST",
      body: buildExtractionSessionBody(model),
      timeoutMs: 10_000,
    });
    sessionID = created?.id ?? null;
    if (!sessionID) throw new OcError("session create returned no id", 500);
  } catch (err) {
    return {
      created: 0,
      skipped: 0,
      errors: [],
      error: `抽出用セッションを作成できませんでした: ${err instanceof Error ? err.message : "原因不明のエラー"}`,
    };
  }

  try {
  try {
    await ocServer(directory, sessionPromptAsyncPath(sessionID), {
      method: "POST",
      body: { parts: [{ type: "text", text: buildExtractionPrompt(transcript) }] },
      timeoutMs: 10_000,
    });
  } catch {
    return {
      created: 0,
      skipped: 0,
      errors: [],
      error: "extraction prompt could not be sent",
    };
  }

  const deadline = Date.now() + MEMORY_EXTRACT_RESULT_TIMEOUT_MS;
  let items: Array<{ kind: string; content: string }> | null = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, MEMORY_EXTRACT_POLL_MS));
    let polled: MessageWithParts[];
    try {
      polled = await ocServer<MessageWithParts[]>(
        directory,
        sessionMessagePath(sessionID),
        { timeoutMs: 10_000 },
      );
    } catch {
      continue;
    }
    const assistants = polled.filter(
      (m) => m.info.role === "assistant" && m.info.time?.completed !== undefined,
    );
    if (assistants.length === 0) continue;
    const last = assistants[assistants.length - 1];
    const reply = messageText(last);
    items = parseExtractionJson(reply);
    if (items !== null) break;
  }

  if (items === null) {
    return {
      created: 0,
      skipped: 0,
      errors: [],
      error: "extraction timed out without a structured reply",
    };
  }

  const result = insertExtractedMemories({
    workspaceId: input.workspaceId,
    sourceSessionId: input.sessionId,
    provenance: "auto-extract",
    approved: false,
    items: items as Array<{ kind: MemoryDto["kind"]; content: string }>,
  });
  logMemoryAudit("extract", {
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    detail: `created=${result.created} skipped=${result.skipped}`,
  });
  return result;
  } finally {
    // Extraction sessions are implementation details; never leave them in the
    // user's session list after a successful run, error, or timeout.
    try {
      await ocServer(directory, sessionPath(sessionID), {
        method: "DELETE",
        timeoutMs: 10_000,
      });
    } catch {
      // Cleanup must not replace the extraction result.
    }
  }
}
