"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { apiUrl, ocJson } from "./client";
import type { IntelligenceVariant } from "./model-variants";
import { dropRecentlyReplied, rememberReplied } from "./recently-replied";
import { isSseSilent, SSE_SILENCE_MS } from "./sse-health";
import type {
  MessageInfo,
  MessageWithParts,
  Part,
  PermissionRequest,
  QuestionInfo,
  QuestionRequest,
  SessionRevert,
  SessionStatus,
  Todo,
} from "./types";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "down";

export type StreamState = {
  scopeKey: string;
  messages: MessageWithParts[];
  status: SessionStatus | null;
  permissions: PermissionRequest[];
  questions: QuestionRequest[];
  todos: Todo[];
  revert: SessionRevert | null;
  connection: ConnectionState;
  sessionError: string | null;
  loaded: boolean;
};

export type StreamAction =
  | { kind: "reset"; scopeKey: string }
  | { kind: "init"; messages: MessageWithParts[] }
  | { kind: "messageUpdated"; info: MessageInfo }
  | { kind: "messageRemoved"; messageID: string }
  | { kind: "partUpdated"; part: Part }
  | { kind: "partRemoved"; messageID: string; partID: string }
  | {
      kind: "partTextDelta";
      messageID: string;
      partID: string;
      delta: string;
      partType: "text" | "reasoning";
      sessionID?: string;
    }
  | { kind: "status"; status: SessionStatus }
  | { kind: "permissionAsked"; request: PermissionRequest }
  | { kind: "permissionReplied"; requestId: string }
  | { kind: "permissionsSynced"; requests: PermissionRequest[]; keepLocalV2?: boolean; syncStartedAt?: number }
  | { kind: "questionAsked"; request: QuestionRequest }
  | { kind: "questionsSynced"; requests: QuestionRequest[]; keepLocalV2?: boolean; syncStartedAt?: number }
  | { kind: "questionReplied"; requestId: string }
  | { kind: "todos"; todos: Todo[] }
  | { kind: "revert"; revert: SessionRevert | null }
  | { kind: "connection"; connection: ConnectionState }
  | { kind: "sessionError"; message: string | null };

/** Default timeout for prompt/command/abort so a hung engine cannot freeze the composer. */
export const SESSION_MUTATION_TIMEOUT_MS = 60_000;

export function createInitialStreamState(scopeKey = ""): StreamState {
  return {
    scopeKey,
    messages: [],
    status: null,
    permissions: [],
    questions: [],
    todos: [],
    revert: null,
    connection: "connecting",
    sessionError: null,
    loaded: false,
  };
}

/** Hide soft-reverted messages the way OpenCode Desktop does. */
export function filterRevertedMessages(
  messages: MessageWithParts[],
  revert: SessionRevert | null,
): MessageWithParts[] {
  if (!revert?.messageID) return messages;
  const out: MessageWithParts[] = [];
  for (const m of messages) {
    if (m.info.id > revert.messageID) continue;
    if (m.info.id < revert.messageID) {
      out.push(m);
      continue;
    }
    // id === revert.messageID
    if (!revert.partID) continue;
    const idx = m.parts.findIndex((p) => p.id === revert.partID);
    if (idx <= 0) continue;
    out.push({ ...m, parts: m.parts.slice(0, idx) });
  }
  return out;
}

function upsertPart(parts: Part[], part: Part): Part[] {
  const idx = parts.findIndex((p) => p.id === part.id);
  if (idx === -1) return [...parts, part];
  const prev = parts[idx]!;
  const next = parts.slice();
  // Merge tool parts so streaming session.next.* patches keep the tool name
  // and prior state fields when later events omit them.
  if (prev.type === "tool" && part.type === "tool") {
    next[idx] = {
      ...prev,
      ...part,
      tool:
        part.tool && part.tool !== "tool" ? part.tool : (prev.tool ?? part.tool),
      state: {
        status: part.state?.status ?? prev.state?.status ?? "pending",
        input: part.state?.input ?? prev.state?.input,
        output: part.state?.output ?? prev.state?.output,
        title: part.state?.title ?? prev.state?.title,
        error: part.state?.error ?? prev.state?.error,
        metadata: part.state?.metadata ?? prev.state?.metadata,
        time: { ...prev.state?.time, ...part.state?.time },
      },
      time: { ...prev.time, ...part.time },
    };
    return next;
  }
  if (
    (prev.type === "text" || prev.type === "reasoning") &&
    prev.type === part.type
  ) {
    const nextText =
      part.text !== undefined && part.text.length > 0
        ? part.text
        : (prev.text ?? part.text);
    next[idx] = {
      ...prev,
      ...part,
      text: nextText,
      time: { ...prev.time, ...part.time },
    };
    return next;
  }
  next[idx] = part;
  return next;
}

export function sessionStreamReducer(
  state: StreamState,
  action: StreamAction,
): StreamState {
  switch (action.kind) {
    case "reset":
      return createInitialStreamState(action.scopeKey);
    case "init":
      return { ...state, messages: action.messages, loaded: true };
    case "messageUpdated": {
      const idx = state.messages.findIndex((m) => m.info.id === action.info.id);
      if (idx === -1) {
        return {
          ...state,
          loaded: true,
          messages: [...state.messages, { info: action.info, parts: [] }],
        };
      }
      const messages = state.messages.slice();
      messages[idx] = { ...messages[idx], info: action.info };
      return { ...state, loaded: true, messages };
    }
    case "messageRemoved":
      return {
        ...state,
        messages: state.messages.filter((m) => m.info.id !== action.messageID),
      };
    case "partUpdated": {
      const { part } = action;
      const idx = state.messages.findIndex((m) => m.info.id === part.messageID);
      if (idx === -1) {
        // part for an unseen message — create a placeholder entry
        return {
          ...state,
          loaded: true,
          messages: [
            ...state.messages,
            {
              info: { id: part.messageID, role: "assistant" },
              parts: [part],
            },
          ],
        };
      }
      const messages = state.messages.slice();
      messages[idx] = {
        ...messages[idx],
        parts: upsertPart(messages[idx].parts, part),
      };
      return { ...state, loaded: true, messages };
    }
    case "partRemoved": {
      const idx = state.messages.findIndex((m) => m.info.id === action.messageID);
      if (idx === -1) return state;
      const messages = state.messages.slice();
      messages[idx] = {
        ...messages[idx],
        parts: messages[idx].parts.filter((p) => p.id !== action.partID),
      };
      return { ...state, messages };
    }
    case "partTextDelta": {
      const idx = state.messages.findIndex((m) => m.info.id === action.messageID);
      const existing =
        idx === -1
          ? undefined
          : state.messages[idx].parts.find((p) => p.id === action.partID);
      const nextPart: Part = {
        id: action.partID,
        messageID: action.messageID,
        sessionID: action.sessionID ?? existing?.sessionID,
        type: action.partType,
        text: `${existing?.text ?? ""}${action.delta}`,
        ...(existing?.time ? { time: existing.time } : {}),
      };
      if (idx === -1) {
        return {
          ...state,
          loaded: true,
          messages: [
            ...state.messages,
            {
              info: { id: action.messageID, role: "assistant" },
              parts: [nextPart],
            },
          ],
        };
      }
      const messages = state.messages.slice();
      messages[idx] = {
        ...messages[idx],
        parts: upsertPart(messages[idx].parts, nextPart),
      };
      return { ...state, loaded: true, messages };
    }
    case "status":
      return { ...state, status: action.status };
    case "permissionAsked": {
      if (state.permissions.some((p) => p.id === action.request.id)) return state;
      return { ...state, permissions: [...state.permissions, action.request] };
    }
    case "permissionReplied":
      return {
        ...state,
        permissions: state.permissions.filter((p) => p.id !== action.requestId),
      };
    case "permissionsSynced": {
      const restIds = new Set(action.requests.map((r) => r.id));
      const keptLocal = state.permissions.filter((p) => {
        if (restIds.has(p.id)) return false;
        if (action.keepLocalV2 && p.version === "v2") return true;
        if (
          typeof action.syncStartedAt === "number" &&
          p.receivedAt > action.syncStartedAt
        ) {
          return true;
        }
        return false;
      });
      return { ...state, permissions: [...action.requests, ...keptLocal] };
    }
    case "questionAsked": {
      if (state.questions.some((q) => q.id === action.request.id)) return state;
      return { ...state, questions: [...state.questions, action.request] };
    }
    case "questionsSynced": {
      const restIds = new Set(action.requests.map((r) => r.id));
      const keptLocal = state.questions.filter((q) => {
        if (restIds.has(q.id)) return false;
        if (action.keepLocalV2 && q.version === "v2") return true;
        if (
          typeof action.syncStartedAt === "number" &&
          q.receivedAt > action.syncStartedAt
        ) {
          return true;
        }
        return false;
      });
      return { ...state, questions: [...action.requests, ...keptLocal] };
    }
    case "questionReplied":
      return {
        ...state,
        questions: state.questions.filter((q) => q.id !== action.requestId),
      };
    case "todos":
      return { ...state, todos: action.todos };
    case "revert":
      return { ...state, revert: action.revert };
    case "connection":
      return { ...state, connection: action.connection };
    case "sessionError":
      return { ...state, sessionError: action.message };
    default:
      return state;
  }
}

/** Live view of one OpenCode session: initial fetch + SSE incremental updates. */
export function useSessionStream(directory: string | null, sessionId: string | null) {
  const scopeKey = `${directory ?? ""}\u0000${sessionId ?? ""}`;
  const [state, dispatch] = useReducer(
    sessionStreamReducer,
    scopeKey,
    createInitialStreamState,
  );
  const sessionRef = useRef(sessionId);
  const scopeRef = useRef(scopeKey);
  const resyncGenRef = useRef(0);
  const statusRef = useRef(state.status);
  /** After sendPrompt/sendCommand until busy/idle SSE — suppress message init races. */
  const pendingMutationRef = useRef(false);
  const connectionRef = useRef<ConnectionState>(state.connection);
  /** After SSE reconnect, trust REST status for one resync (may have gone idle offline). */
  const preferRestStatusRef = useRef(false);
  sessionRef.current = sessionId;
  scopeRef.current = scopeKey;
  statusRef.current = state.status;
  connectionRef.current = state.connection;

  useEffect(() => {
    dispatch({ kind: "reset", scopeKey });
    pendingMutationRef.current = false;
  }, [scopeKey]);

  const resync = useCallback(async () => {
    const sid = sessionRef.current;
    if (!directory || !sid) return;
    const requestedScope = `${directory}\u0000${sid}`;
    const gen = ++resyncGenRef.current;
    const syncStartedAt = Date.now();
    const stale = () =>
      scopeRef.current !== requestedScope || gen !== resyncGenRef.current;

    let messageError: unknown = null;
    try {
      const rows = await ocJson<MessageWithParts[]>(
        `/session/${sid}/message`,
        directory,
      );
      if (stale()) return;
      // While streaming, a full REST replace can wipe in-flight session.next
      // deltas that the server snapshot has not caught up to yet.
      // Do not require `loaded` — opening an already-busy session can receive
      // SSE deltas before the first resync completes.
      const streaming =
        pendingMutationRef.current ||
        statusRef.current?.type === "busy" ||
        statusRef.current?.type === "retry";
      if (!streaming) {
        dispatch({ kind: "init", messages: Array.isArray(rows) ? rows : [] });
      }
    } catch (err) {
      messageError = err;
    }

    try {
      const statuses = await ocJson<Record<string, SessionStatus>>(
        "/session/status",
        directory,
      );
      if (stale()) return;
      if (statuses[sid]) {
        const next = statuses[sid]!;
        const cur = statusRef.current?.type;
        // While SSE is live, REST can lag and report idle mid-turn. After SSE
        // disconnect/reconnect, preferRestStatus trusts REST idle again.
        const staleIdle =
          !preferRestStatusRef.current &&
          connectionRef.current === "live" &&
          (cur === "busy" || cur === "retry") &&
          next.type === "idle";
        const staleBusy =
          cur === "idle" && (next.type === "busy" || next.type === "retry");
        if (!staleIdle && !staleBusy) {
          dispatch({ kind: "status", status: next });
        }
      }
    } catch (err) {
      if (!messageError) messageError = err;
    }

    try {
      const session = await ocJson<{ revert?: SessionRevert | null }>(
        `/session/${sid}`,
        directory,
      );
      if (stale()) return;
      dispatch({ kind: "revert", revert: session.revert ?? null });
    } catch {
      if (stale()) return;
      dispatch({ kind: "revert", revert: null });
    }

    // Recover todos
    try {
      const todos = await ocJson<Todo[]>(`/session/${sid}/todo`, directory);
      if (stale()) return;
      if (Array.isArray(todos)) dispatch({ kind: "todos", todos });
    } catch {
      /* non-fatal */
    }

    // Recover pending permissions (v1 list + v2 session-scoped list).
    // Always attempted even when message fetch failed, so answered cards clear.
    try {
      type PermRow = {
        id?: string;
        sessionID?: string;
        permission?: string;
        action?: string;
        patterns?: string[];
        resources?: string[];
      };
      const normalizeList = (pending: unknown): PermRow[] => {
        if (Array.isArray(pending)) return pending as PermRow[];
        if (
          pending &&
          typeof pending === "object" &&
          Array.isArray((pending as { data?: unknown }).data)
        ) {
          return (pending as { data: PermRow[] }).data;
        }
        return [];
      };
      const toRequest = (
        p: PermRow,
        version: "v1" | "v2",
      ): PermissionRequest | null => {
        const id = String(p.id ?? "");
        const sessionID = String(p.sessionID ?? sid);
        if (!id || sessionID !== sid) return null;
        return {
          id,
          version,
          sessionID,
          permission: String(p.permission ?? p.action ?? "permission"),
          patterns: (p.patterns ?? p.resources ?? []) as string[],
          receivedAt: Date.now(),
        };
      };
      const v1raw = await ocJson<unknown>("/permission", directory).catch(
        () => [],
      );
      let v2ok = false;
      let v2raw: unknown = [];
      try {
        v2raw = await ocJson<unknown>(
          `/api/session/${sid}/permission`,
          directory,
        );
        v2ok = true;
      } catch {
        v2ok = false;
      }
      if (stale()) return;
      const byId = new Map<string, PermissionRequest>();
      for (const p of normalizeList(v1raw)) {
        const req = toRequest(p, "v1");
        if (req) byId.set(req.id, req);
      }
      if (v2ok) {
        for (const p of normalizeList(v2raw)) {
          const req = toRequest(p, "v2");
          if (req) byId.set(req.id, req);
        }
      }
      dispatch({
        kind: "permissionsSynced",
        requests: dropRecentlyReplied([...byId.values()]),
        keepLocalV2: !v2ok,
        syncStartedAt,
      });
    } catch {
      /* non-fatal */
    }

    // Recover pending questions (v1 + v2). Same merge rationale as permissions.
    try {
      type QRow = {
        id?: string;
        sessionID?: string;
        questions?: QuestionInfo[];
      };
      const normalizeList = (pending: unknown): QRow[] => {
        if (Array.isArray(pending)) return pending as QRow[];
        if (
          pending &&
          typeof pending === "object" &&
          Array.isArray((pending as { data?: unknown }).data)
        ) {
          return (pending as { data: QRow[] }).data;
        }
        return [];
      };
      const toRequest = (
        q: QRow,
        version: "v1" | "v2",
      ): QuestionRequest | null => {
        const id = String(q.id ?? "");
        const sessionID = String(q.sessionID ?? sid);
        if (!id || sessionID !== sid) return null;
        return {
          id,
          version,
          sessionID,
          questions: q.questions ?? [],
          receivedAt: Date.now(),
        };
      };
      const v1raw = await ocJson<unknown>("/question", directory).catch(
        () => [],
      );
      let v2ok = false;
      let v2raw: unknown = [];
      try {
        v2raw = await ocJson<unknown>(
          `/api/session/${sid}/question`,
          directory,
        );
        v2ok = true;
      } catch {
        v2ok = false;
      }
      if (stale()) return;
      const byId = new Map<string, QuestionRequest>();
      for (const q of normalizeList(v1raw)) {
        const req = toRequest(q, "v1");
        if (req) byId.set(req.id, req);
      }
      if (v2ok) {
        for (const q of normalizeList(v2raw)) {
          const req = toRequest(q, "v2");
          if (req) byId.set(req.id, req);
        }
      }
      dispatch({
        kind: "questionsSynced",
        requests: dropRecentlyReplied([...byId.values()]),
        keepLocalV2: !v2ok,
        syncStartedAt,
      });
    } catch {
      /* non-fatal: SSE will deliver question.asked */
    }

    if (stale()) return;
    if (messageError) {
      dispatch({
        kind: "sessionError",
        message:
          messageError instanceof Error
            ? messageError.message
            : "読み込みに失敗しました",
      });
      return;
    }
    dispatch({ kind: "sessionError", message: null });
  }, [directory]);

  useEffect(() => {
    if (!directory || !sessionId) return;

    const effectScope = `${directory}\u0000${sessionId}`;
    let cancelled = false;
    let es: EventSource | null = null;
    let retryMs = 1000;
    let failStreak = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let nextResyncTimer: ReturnType<typeof setTimeout> | null = null;
    let lastActivityAt = Date.now();
    /** Accrue session.next.tool.input.delta fragments until .ended / .called. */
    const toolInputBuf = new Map<string, string>();
    const markActivity = () => {
      lastActivityAt = Date.now();
    };
    const scheduleNextResync = () => {
      if (nextResyncTimer) clearTimeout(nextResyncTimer);
      nextResyncTimer = setTimeout(() => {
        nextResyncTimer = null;
        if (scopeRef.current !== effectScope) return;
        void resync();
      }, 300);
    };

    void resync();

    const handleEvent = (raw: string) => {
      markActivity();
      if (scopeRef.current !== effectScope) return;
      let payload: {
        type?: string;
        properties?: Record<string, unknown>;
        data?: Record<string, unknown>;
      };
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      const type = payload.type ?? "";
      const props = (payload.properties ?? payload.data ?? {}) as Record<
        string,
        unknown
      >;
      const sid = sessionRef.current;

      if (type === "message.updated") {
        const info = props.info as MessageInfo | undefined;
        const eventSession =
          (props.sessionID as string | undefined) ?? info?.sessionID;
        if (info && eventSession === sid) {
          dispatch({ kind: "messageUpdated", info });
        }
        return;
      }
      if (type === "message.removed") {
        if (props.sessionID === sid && typeof props.messageID === "string") {
          dispatch({ kind: "messageRemoved", messageID: props.messageID });
        }
        return;
      }
      if (type === "message.part.updated") {
        const part = props.part as Part | undefined;
        const eventSession = (props.sessionID as string) ?? part?.sessionID;
        if (part && eventSession === sid) {
          dispatch({ kind: "partUpdated", part });
        }
        return;
      }
      if (type === "message.part.removed") {
        if (
          props.sessionID === sid &&
          typeof props.messageID === "string" &&
          typeof props.partID === "string"
        ) {
          dispatch({
            kind: "partRemoved",
            messageID: props.messageID,
            partID: props.partID,
          });
        }
        return;
      }
      if (type === "session.status") {
        if (props.sessionID === sid && props.status) {
          const status = props.status as SessionStatus;
          if (status.type === "busy" || status.type === "retry" || status.type === "idle") {
            pendingMutationRef.current = false;
          }
          dispatch({ kind: "status", status });
        }
        return;
      }
      if (type === "session.idle") {
        if (props.sessionID === sid) {
          pendingMutationRef.current = false;
          dispatch({ kind: "status", status: { type: "idle" } });
          // After busy-period init skip, pull the authoritative message list.
          scheduleNextResync();
        }
        return;
      }
      if (type === "session.compacted") {
        if (props.sessionID === sid) {
          scheduleNextResync();
        }
        return;
      }
      if (type === "session.error") {
        const err = props.error as { data?: { message?: string } } | undefined;
        // Only surface errors that clearly belong to this session.
        if (props.sessionID === sid) {
          dispatch({
            kind: "sessionError",
            message: err?.data?.message ?? "セッションでエラーが発生しました",
          });
        }
        return;
      }
      if (type === "todo.updated") {
        if (props.sessionID === sid && Array.isArray(props.todos)) {
          dispatch({ kind: "todos", todos: props.todos as Todo[] });
        }
        return;
      }
      if (type === "permission.asked" || type === "permission.v2.asked") {
        const id = String(props.id ?? "");
        const sessionID = String(props.sessionID ?? "");
        if (!id || sessionID !== sid) return;
        dispatch({
          kind: "permissionAsked",
          request: {
            id,
            version: type === "permission.asked" ? "v1" : "v2",
            sessionID,
            permission: String(props.permission ?? props.action ?? "permission"),
            patterns: (props.patterns ?? props.resources ?? []) as string[],
            metadata: props.metadata as Record<string, unknown> | undefined,
            always: props.always as string[] | undefined,
            receivedAt: Date.now(),
          },
        });
        return;
      }
      if (type === "permission.replied" || type === "permission.v2.replied") {
        if (!props.sessionID || props.sessionID !== sid) return;
        const requestId = String(props.requestID ?? props.id ?? "");
        if (requestId) dispatch({ kind: "permissionReplied", requestId });
        return;
      }
      if (type === "question.asked" || type === "question.v2.asked") {
        const id = String(props.id ?? "");
        const sessionID = String(props.sessionID ?? "");
        if (!id || sessionID !== sid) return;
        const questions = (props.questions ?? []) as QuestionInfo[];
        dispatch({
          kind: "questionAsked",
          request: {
            id,
            version: type === "question.asked" ? "v1" : "v2",
            sessionID,
            questions,
            receivedAt: Date.now(),
          },
        });
        return;
      }
      if (
        type === "question.replied" ||
        type === "question.rejected" ||
        type === "question.v2.replied" ||
        type === "question.v2.rejected"
      ) {
        if (!props.sessionID || props.sessionID !== sid) return;
        const requestId = String(props.requestID ?? props.id ?? "");
        if (requestId) dispatch({ kind: "questionReplied", requestId });
        return;
      }

      // OpenCode "session.next.*" streaming events (v2 path).
      if (type.startsWith("session.next.") && sid && props.sessionID === sid) {
        if (
          type === "session.next.text.started" ||
          type === "session.next.reasoning.started"
        ) {
          const partType =
            type === "session.next.reasoning.started" ? "reasoning" : "text";
          const partID = String(
            (partType === "text" ? props.textID : props.reasoningID) ?? "",
          );
          const messageID = String(props.assistantMessageID ?? "");
          if (partID && messageID) {
            dispatch({
              kind: "partUpdated",
              part: {
                id: partID,
                messageID,
                sessionID: sid,
                type: partType,
                text: "",
                time: { start: Number(props.timestamp) || undefined },
              },
            });
          }
          return;
        }
        if (
          type === "session.next.text.delta" ||
          type === "session.next.reasoning.delta"
        ) {
          const partType =
            type === "session.next.reasoning.delta" ? "reasoning" : "text";
          const partID = String(
            (partType === "text" ? props.textID : props.reasoningID) ?? "",
          );
          const messageID = String(props.assistantMessageID ?? "");
          const delta = typeof props.delta === "string" ? props.delta : "";
          if (partID && messageID && delta) {
            dispatch({
              kind: "partTextDelta",
              messageID,
              partID,
              delta,
              partType,
              sessionID: sid,
            });
          }
          return;
        }
        if (
          type === "session.next.text.ended" ||
          type === "session.next.reasoning.ended"
        ) {
          const partType =
            type === "session.next.reasoning.ended" ? "reasoning" : "text";
          const partID = String(
            (partType === "text" ? props.textID : props.reasoningID) ?? "",
          );
          const messageID = String(props.assistantMessageID ?? "");
          if (partID && messageID) {
            const endedText =
              typeof props.text === "string" ? props.text : undefined;
            dispatch({
              kind: "partUpdated",
              part: {
                id: partID,
                messageID,
                sessionID: sid,
                type: partType,
                ...(endedText !== undefined ? { text: endedText } : {}),
                time: {
                  end: Number(props.timestamp) || undefined,
                },
              },
            });
          }
          return;
        }
        if (type === "session.next.tool.input.started") {
          const callID = String(props.callID ?? "");
          const messageID = String(props.assistantMessageID ?? "");
          if (callID && messageID) {
            toolInputBuf.set(callID, "");
            dispatch({
              kind: "partUpdated",
              part: {
                id: callID,
                messageID,
                sessionID: sid,
                type: "tool",
                tool: String(props.name ?? "tool"),
                callID,
                state: {
                  status: "pending",
                  time: { start: Number(props.timestamp) || undefined },
                },
              },
            });
          }
          return;
        }
        if (type === "session.next.tool.input.delta") {
          const callID = String(props.callID ?? "");
          const messageID = String(props.assistantMessageID ?? "");
          const delta = typeof props.delta === "string" ? props.delta : "";
          if (callID && messageID && delta) {
            const raw = (toolInputBuf.get(callID) ?? "") + delta;
            toolInputBuf.set(callID, raw);
            let input: Record<string, unknown> = { _partial: raw };
            try {
              const parsed = JSON.parse(raw) as unknown;
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                input = parsed as Record<string, unknown>;
              }
            } catch {
              /* partial JSON while streaming */
            }
            dispatch({
              kind: "partUpdated",
              part: {
                id: callID,
                messageID,
                sessionID: sid,
                type: "tool",
                tool: "tool",
                callID,
                state: {
                  status: "pending",
                  input,
                },
              },
            });
          }
          return;
        }
        if (type === "session.next.tool.input.ended") {
          const callID = String(props.callID ?? "");
          const messageID = String(props.assistantMessageID ?? "");
          if (callID && messageID) {
            const text =
              typeof props.text === "string"
                ? props.text
                : (toolInputBuf.get(callID) ?? "");
            toolInputBuf.delete(callID);
            let input: Record<string, unknown> = {};
            if (text) {
              try {
                const parsed = JSON.parse(text) as unknown;
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                  input = parsed as Record<string, unknown>;
                } else {
                  input = { raw: text };
                }
              } catch {
                input = { raw: text };
              }
            }
            dispatch({
              kind: "partUpdated",
              part: {
                id: callID,
                messageID,
                sessionID: sid,
                type: "tool",
                tool: "tool",
                callID,
                state: {
                  status: "pending",
                  input,
                },
              },
            });
          }
          return;
        }
        if (type === "session.next.tool.called") {
          const callID = String(props.callID ?? "");
          const messageID = String(props.assistantMessageID ?? "");
          if (callID && messageID) {
            toolInputBuf.delete(callID);
            dispatch({
              kind: "partUpdated",
              part: {
                id: callID,
                messageID,
                sessionID: sid,
                type: "tool",
                tool: String(props.tool ?? "tool"),
                callID,
                state: {
                  status: "running",
                  input: (props.input as Record<string, unknown>) ?? {},
                  time: { start: Number(props.timestamp) || undefined },
                },
              },
            });
          }
          return;
        }
        if (type === "session.next.tool.success") {
          const callID = String(props.callID ?? "");
          const messageID = String(props.assistantMessageID ?? "");
          if (callID && messageID) {
            const content = Array.isArray(props.content) ? props.content : [];
            const output = content
              .map((c) => {
                if (c && typeof c === "object" && "text" in c) {
                  return String((c as { text?: string }).text ?? "");
                }
                return "";
              })
              .filter(Boolean)
              .join("\n");
            dispatch({
              kind: "partUpdated",
              part: {
                id: callID,
                messageID,
                sessionID: sid,
                type: "tool",
                tool: "tool",
                callID,
                state: {
                  status: "completed",
                  output,
                  metadata: (props.structured as Record<string, unknown>) ?? {},
                  time: { end: Number(props.timestamp) || undefined },
                },
              },
            });
          }
          scheduleNextResync();
          return;
        }
        if (type === "session.next.tool.failed") {
          const callID = String(props.callID ?? "");
          const messageID = String(props.assistantMessageID ?? "");
          if (callID && messageID) {
            const err = props.error as { message?: string } | undefined;
            dispatch({
              kind: "partUpdated",
              part: {
                id: callID,
                messageID,
                sessionID: sid,
                type: "tool",
                tool: "tool",
                callID,
                state: {
                  status: "error",
                  error: err?.message ?? "tool failed",
                  time: { end: Number(props.timestamp) || undefined },
                },
              },
            });
          }
          scheduleNextResync();
          return;
        }
        if (type === "session.next.step.failed") {
          const err = props.error as { data?: { message?: string }; message?: string } | undefined;
          dispatch({
            kind: "sessionError",
            message:
              err?.data?.message ??
              err?.message ??
              "セッションのステップが失敗しました",
          });
          scheduleNextResync();
          return;
        }
        // Compaction / revert / prompt lifecycle: rely on REST resync.
        scheduleNextResync();
      }
    };

    const connect = (
      isReconnect: boolean,
      reason: "initial" | "error" | "silence" = "initial",
    ) => {
      if (cancelled) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (es) {
        es.onerror = null;
        es.close();
      }
      dispatch({
        kind: "connection",
        connection: isReconnect ? "reconnecting" : "connecting",
      });
      es = new EventSource(apiUrl("/api/opencode/event", { directory }));

      es.onopen = () => {
        markActivity();
        retryMs = 1000;
        failStreak = 0;
        dispatch({ kind: "connection", connection: "live" });
        if (isReconnect) {
          // Only trust REST idle after a real error disconnect. Silence
          // reconnects can happen mid-turn while the session is still busy.
          preferRestStatusRef.current = reason === "error";
          void resync().finally(() => {
            preferRestStatusRef.current = false;
          });
        }
      };
      es.onmessage = (ev) => handleEvent(ev.data);
      es.addEventListener("heartbeat", () => {
        markActivity();
      });
      es.onerror = () => {
        if (cancelled) return;
        es?.close();
        failStreak += 1;
        dispatch({
          kind: "connection",
          connection: failStreak >= 5 ? "down" : "reconnecting",
        });
        timer = setTimeout(() => connect(true, "error"), retryMs);
        retryMs = Math.min(retryMs * 2, 15_000);
      };
    };

    const silenceWatch = setInterval(() => {
      if (cancelled || !es || es.readyState !== EventSource.OPEN) return;
      if (!isSseSilent(lastActivityAt, Date.now(), SSE_SILENCE_MS)) return;
      connect(true, "silence");
    }, 5_000);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      markActivity();
      void resync();
    };
    document.addEventListener("visibilitychange", onVisible);

    connect(false);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (nextResyncTimer) clearTimeout(nextResyncTimer);
      clearInterval(silenceWatch);
      document.removeEventListener("visibilitychange", onVisible);
      es?.close();
    };
  }, [directory, sessionId, resync]);

  const sendPrompt = useCallback(
    async (
      text: string,
      opts?: {
        agent?: string;
        model?: { providerID: string; modelID: string };
        files?: { uri: string; mime: string; name?: string }[];
        variant?: IntelligenceVariant;
      },
    ) => {
      const sid = sessionRef.current;
      if (!directory || !sid) throw new Error("session not ready");
      // Guard resync init for the whole POST window, not only after success.
      pendingMutationRef.current = true;
      dispatch({ kind: "status", status: { type: "busy" } });
      const parts: Record<string, unknown>[] = [{ type: "text", text }];
      if (opts?.files && opts.files.length > 0) {
        for (const f of opts.files) {
          parts.push({
            type: "file",
            mime: f.mime,
            url: f.uri,
            ...(f.name ? { filename: f.name } : {}),
          });
        }
      }
      const body: Record<string, unknown> = { parts };
      if (opts?.agent?.trim()) body.agent = opts.agent.trim();
      if (opts?.model?.providerID && opts.model.modelID) {
        body.model = opts.model;
      }
      if (opts?.variant) {
        body.variant = opts.variant;
      }
      try {
        await ocJson(`/session/${sid}/prompt_async`, directory, {
          method: "POST",
          body,
          timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
        });
      } catch (err) {
        pendingMutationRef.current = false;
        dispatch({ kind: "status", status: { type: "idle" } });
        throw err;
      }
      // safety net: events normally arrive first, resync fills any gap
      setTimeout(() => void resync(), 800);
    },
    [directory, resync],
  );

  const sendCommand = useCallback(
    async (
      command: string,
      args: string,
      opts?: {
        agent?: string;
        model?: { providerID: string; modelID: string };
        files?: { uri: string; mime: string; name?: string }[];
        variant?: IntelligenceVariant;
      },
    ) => {
      const sid = sessionRef.current;
      if (!directory || !sid) throw new Error("session not ready");
      pendingMutationRef.current = true;
      dispatch({ kind: "status", status: { type: "busy" } });
      const body: Record<string, unknown> = {
        command,
        arguments: args,
      };
      if (opts?.agent?.trim()) body.agent = opts.agent.trim();
      if (opts?.model?.providerID && opts.model.modelID) {
        // OpenAPI session.command expects model as "provider/model" string.
        body.model = `${opts.model.providerID}/${opts.model.modelID}`;
      }
      if (opts?.variant) body.variant = opts.variant;
      if (opts?.files && opts.files.length > 0) {
        body.parts = opts.files.map((f) => ({
          type: "file",
          mime: f.mime,
          url: f.uri,
          ...(f.name ? { filename: f.name } : {}),
        }));
      }
      try {
        await ocJson(`/session/${sid}/command`, directory, {
          method: "POST",
          body,
          timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
        });
      } catch (err) {
        pendingMutationRef.current = false;
        dispatch({ kind: "status", status: { type: "idle" } });
        throw err;
      }
      setTimeout(() => void resync(), 800);
    },
    [directory, resync],
  );

  // Re-fetch the todo list on demand. The engine occasionally skips the final
  // `todo.updated` event when a session goes idle, which left the "進行中" badge
  // stuck after completion. Callers (e.g. TaskView on busy→idle) use this to
  // reconcile the displayed list with the server state.
  const refreshTodos = useCallback(async () => {
    const sid = sessionRef.current;
    if (!directory || !sid) return;
    try {
      const todos = await ocJson<Todo[]>(`/session/${sid}/todo`, directory);
      if (sessionRef.current !== sid) return;
      if (Array.isArray(todos)) dispatch({ kind: "todos", todos });
    } catch {
      /* non-fatal: SSE may still deliver updates */
    }
  }, [directory]);

  const abort = useCallback(async () => {
    const sid = sessionRef.current;
    if (!directory || !sid) return;
    await ocJson(`/session/${sid}/abort`, directory, {
      method: "POST",
      timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
    });
    // SSE may omit session.idle after abort; unlock composer immediately and
    // reconcile from REST so we do not stay stuck in working/readOnly.
    if (sessionRef.current === sid) {
      pendingMutationRef.current = false;
      statusRef.current = { type: "idle" };
      dispatch({ kind: "status", status: { type: "idle" } });
    }
    await resync();
  }, [directory, resync]);

  const replyPermission = useCallback(
    async (request: PermissionRequest, response: "once" | "always" | "reject") => {
      if (!directory) return;
      try {
        if (request.version === "v2") {
          await ocJson(
            `/api/session/${request.sessionID}/permission/${request.id}/reply`,
            directory,
            {
              method: "POST",
              body: { reply: response },
              timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
            },
          );
        } else {
          await ocJson(
            `/session/${request.sessionID}/permissions/${request.id}`,
            directory,
            {
              method: "POST",
              body: { response },
              timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
            },
          );
        }
      } catch (err) {
        // 404 = already answered elsewhere; drop it from the queue either way
        if (!(err instanceof Error && /404/.test(err.message))) throw err;
      }
      rememberReplied(request.id);
      dispatch({ kind: "permissionReplied", requestId: request.id });
    },
    [directory],
  );

  const replyQuestion = useCallback(
    async (request: QuestionRequest, answers: string[][]) => {
      if (!directory) return;
      try {
        if (request.version === "v2") {
          await ocJson(
            `/api/session/${request.sessionID}/question/${request.id}/reply`,
            directory,
            {
              method: "POST",
              body: { answers },
              timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
            },
          );
        } else {
          await ocJson(`/question/${request.id}/reply`, directory, {
            method: "POST",
            body: { answers },
            timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
          });
        }
      } catch (err) {
        if (!(err instanceof Error && /404/.test(err.message))) throw err;
      }
      rememberReplied(request.id);
      dispatch({ kind: "questionReplied", requestId: request.id });
    },
    [directory],
  );

  const rejectQuestion = useCallback(
    async (request: QuestionRequest) => {
      if (!directory) return;
      try {
        if (request.version === "v2") {
          await ocJson(
            `/api/session/${request.sessionID}/question/${request.id}/reject`,
            directory,
            { method: "POST", timeoutMs: SESSION_MUTATION_TIMEOUT_MS },
          );
        } else {
          await ocJson(`/question/${request.id}/reject`, directory, {
            method: "POST",
            timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
          });
        }
      } catch (err) {
        if (!(err instanceof Error && /404/.test(err.message))) throw err;
      }
      rememberReplied(request.id);
      dispatch({ kind: "questionReplied", requestId: request.id });
    },
    [directory],
  );

  // Effects reset the reducer after a scope change. Gate the render as well so
  // React never paints the previous session's messages during that transition.
  const visibleState =
    state.scopeKey === scopeKey ? state : createInitialStreamState(scopeKey);
  const visibleMessages = useMemo(
    () => filterRevertedMessages(visibleState.messages, visibleState.revert),
    [visibleState.messages, visibleState.revert],
  );

  return {
    ...visibleState,
    visibleMessages,
    resync,
    sendPrompt,
    sendCommand,
    abort,
    refreshTodos,
    replyPermission,
    replyQuestion,
    rejectQuestion,
  };
}
