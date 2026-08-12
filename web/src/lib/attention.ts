import { isResolvedRequestEventType } from "./opencode-events";
import {
  permissionReplyPathV1,
  permissionReplyPathV2,
  questionRejectPathV1,
  questionRejectPathV2,
  questionReplyPathV1,
  questionReplyPathV2,
} from "./opencode-paths";
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

/** Descendant session revealed by global `session.created` (edit-ceiling sync). */
export type GlobalSessionCreated = {
  directory: string;
  sessionID: string;
  parentID: string;
};

/**
 * Parse a global SSE `session.created` payload for access-ceiling sync.
 * Returns null for unrelated events or incomplete parent/child ids.
 */
export function parseGlobalSessionCreated(raw: string): GlobalSessionCreated | null {
  let envelope: GlobalEventEnvelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return null;
  }
  const { type, directory, props } = normalizeEnvelope(envelope);
  if (type !== "session.created" || !directory) return null;
  const info = props.info as { id?: unknown; parentID?: unknown } | undefined;
  const sessionID =
    typeof info?.id === "string"
      ? info.id.trim()
      : typeof props.sessionID === "string"
        ? props.sessionID.trim()
        : "";
  const parentID =
    typeof info?.parentID === "string"
      ? info.parentID.trim()
      : typeof props.parentID === "string"
        ? props.parentID.trim()
        : "";
  if (!sessionID || !parentID || sessionID.length > 256) return null;
  return { directory, sessionID, parentID };
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
  const { sessionID, id, version } = item.request;
  if (item.kind === "permission") {
    return version === "v2"
      ? permissionReplyPathV2(sessionID, id)
      : permissionReplyPathV1(sessionID, id);
  }
  // question
  return version === "v2"
    ? questionReplyPathV2(sessionID, id)
    : questionReplyPathV1(id);
}

export function rejectPath(item: AttentionItem): string | null {
  if (item.kind !== "question") return null;
  const { sessionID, id, version } = item.request;
  return version === "v2"
    ? questionRejectPathV2(sessionID, id)
    : questionRejectPathV1(id);
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
  if (isResolvedRequestEventType(type)) {
    const requestId = String(props.requestID ?? props.id ?? "");
    const sessionID = String(props.sessionID ?? "");
    if (!requestId || !sessionID) return null;
    return { requestId, sessionID };
  }
  return null;
}
