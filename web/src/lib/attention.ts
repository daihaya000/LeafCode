import type { PermissionRequest, QuestionRequest } from "./types";

export type AttentionItem =
  | { kind: "permission"; directory: string; request: PermissionRequest }
  | { kind: "question"; directory: string; request: QuestionRequest };

export type AttentionScope = { directory: string; sessionId: string };

export function scopeKey(scope: AttentionScope): string {
  return `${scope.directory}\u0000${scope.sessionId}`;
}

export function parseGlobalEvent(raw: string): AttentionItem | null {
  let payload: {
    type?: string;
    directory?: string;
    properties?: Record<string, unknown>;
    data?: Record<string, unknown>;
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  const type = payload.type ?? "";
  const directory = String(payload.directory ?? "");
  const props = (payload.properties ?? payload.data ?? {}) as Record<string, unknown>;
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

export function isResolvedEvent(raw: string): string | null {
  let payload: { type?: string; properties?: Record<string, unknown>; data?: Record<string, unknown> };
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  const type = payload.type ?? "";
  const props = payload.properties ?? payload.data ?? {};
  if (
    type === "permission.replied" ||
    type === "permission.v2.replied" ||
    type === "question.replied" ||
    type === "question.rejected" ||
    type === "question.v2.replied" ||
    type === "question.v2.rejected"
  ) {
    return String(props.requestID ?? props.id ?? "");
  }
  return null;
}
