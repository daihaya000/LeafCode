import type { PermissionRequest, QuestionRequest } from "./types";

export type AttentionItem =
  | { kind: "permission"; directory: string; request: PermissionRequest }
  | { kind: "question"; directory: string; request: QuestionRequest };

export type AttentionScope = { directory: string; sessionId: string };

/** Stable identity for one pending request across SSE and REST sources. */
export function attentionItemKey(item: AttentionItem): string {
  return `${item.kind}\u0000${item.directory}\u0000${item.request.sessionID}\u0000${item.request.id}`;
}

export function scopeKey(scope: AttentionScope): string {
  return `${scope.directory}\u0000${scope.sessionId}`;
}

/** OpenCode REST often wraps lists as `{ data: T[] }` instead of a bare array. */
export function normalizeOcList<T>(pending: unknown): T[] {
  if (Array.isArray(pending)) return pending as T[];
  if (
    pending &&
    typeof pending === "object" &&
    Array.isArray((pending as { data?: unknown }).data)
  ) {
    return (pending as { data: T[] }).data;
  }
  return [];
}

type GlobalEventEnvelope = {
  type?: string;
  directory?: string;
  properties?: Record<string, unknown>;
  data?: Record<string, unknown>;
  payload?: {
    type?: string;
    directory?: string;
    properties?: Record<string, unknown>;
  };
};

function normalizeEnvelope(envelope: GlobalEventEnvelope): {
  type: string;
  directory: string;
  props: Record<string, unknown>;
} {
  const nested = envelope.payload;
  return {
    type: String(nested?.type ?? envelope.type ?? ""),
    directory: String(envelope.directory ?? nested?.directory ?? ""),
    props: (nested?.properties ?? envelope.properties ?? envelope.data ?? {}) as Record<
      string,
      unknown
    >,
  };
}

export function parseGlobalEvent(raw: string): AttentionItem | null {
  let envelope: GlobalEventEnvelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return null;
  }
  const { type, directory, props } = normalizeEnvelope(envelope);
  const id = String(props.id ?? "");
  const sessionID = String(props.sessionID ?? "");
  if (!id || !sessionID || !directory) return null;
  const receivedAt = Date.now();

  if (type === "permission.asked" || type === "permission.v2.asked") {
    const version: "v1" | "v2" = type === "permission.v2.asked" ? "v2" : "v1";
    return {
      kind: "permission",
      directory,
      request: {
        id,
        version,
        sessionID,
        permission: String(props.permission ?? props.action ?? "permission"),
        patterns: (props.patterns ?? props.resources ?? []) as string[],
        metadata: props.metadata as Record<string, unknown> | undefined,
        always: props.always as string[] | undefined,
        receivedAt,
      },
    };
  }

  if (type === "question.asked" || type === "question.v2.asked") {
    const version: "v1" | "v2" = type === "question.v2.asked" ? "v2" : "v1";
    return {
      kind: "question",
      directory,
      request: {
        id,
        version,
        sessionID,
        questions: (props.questions ?? []) as QuestionRequest["questions"],
        receivedAt,
      },
    };
  }

  return null;
}

export function replyPath(item: AttentionItem): string {
  if (item.kind === "permission") {
    if (item.request.version === "v2") {
      return `/api/session/${item.request.sessionID}/permission/${item.request.id}/reply`;
    }
    return `/session/${item.request.sessionID}/permissions/${item.request.id}`;
  }
  // question
  if (item.request.version === "v2") {
    return `/api/session/${item.request.sessionID}/question/${item.request.id}/reply`;
  }
  return `/question/${item.request.id}/reply`;
}

export function rejectPath(item: AttentionItem): string | null {
  if (item.kind !== "question") return null;
  if (item.request.version === "v2") {
    return `/api/session/${item.request.sessionID}/question/${item.request.id}/reject`;
  }
  return `/question/${item.request.id}/reject`;
}

export function isResolvedEvent(
  raw: string,
): { requestId: string; sessionID: string } | null {
  let envelope: GlobalEventEnvelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return null;
  }
  const { type, props } = normalizeEnvelope(envelope);
  if (
    type === "permission.replied" ||
    type === "permission.v2.replied" ||
    type === "question.replied" ||
    type === "question.rejected" ||
    type === "question.v2.replied" ||
    type === "question.v2.rejected"
  ) {
    const requestId = String(props.requestID ?? props.id ?? "");
    const sessionID = String(props.sessionID ?? "");
    if (!requestId || !sessionID) return null;
    return { requestId, sessionID };
  }
  return null;
}
