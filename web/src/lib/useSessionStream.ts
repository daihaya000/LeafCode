"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { apiUrl, ocJson } from "./client";
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
  | { kind: "partUpdated"; part: Part }
  | { kind: "status"; status: SessionStatus }
  | { kind: "permissionAsked"; request: PermissionRequest }
  | { kind: "permissionReplied"; requestId: string }
  | { kind: "permissionsSynced"; requests: PermissionRequest[] }
  | { kind: "questionAsked"; request: QuestionRequest }
  | { kind: "questionsSynced"; requests: QuestionRequest[] }
  | { kind: "questionReplied"; requestId: string }
  | { kind: "todos"; todos: Todo[] }
  | { kind: "revert"; revert: SessionRevert | null }
  | { kind: "connection"; connection: ConnectionState }
  | { kind: "sessionError"; message: string | null };

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
  const next = parts.slice();
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
          messages: [...state.messages, { info: action.info, parts: [] }],
        };
      }
      const messages = state.messages.slice();
      messages[idx] = { ...messages[idx], info: action.info };
      return { ...state, messages };
    }
    case "partUpdated": {
      const { part } = action;
      const idx = state.messages.findIndex((m) => m.info.id === part.messageID);
      if (idx === -1) {
        // part for an unseen message — create a placeholder entry
        return {
          ...state,
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
      return { ...state, messages };
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
    case "permissionsSynced":
      return { ...state, permissions: action.requests };
    case "questionAsked": {
      if (state.questions.some((q) => q.id === action.request.id)) return state;
      return { ...state, questions: [...state.questions, action.request] };
    }
    case "questionsSynced":
      return { ...state, questions: action.requests };
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
  sessionRef.current = sessionId;
  scopeRef.current = scopeKey;

  useEffect(() => {
    dispatch({ kind: "reset", scopeKey });
  }, [scopeKey]);

  const resync = useCallback(async () => {
    const sid = sessionRef.current;
    if (!directory || !sid) return;
    const requestedScope = `${directory}\u0000${sid}`;
    const stale = () => scopeRef.current !== requestedScope;
    try {
      const rows = await ocJson<MessageWithParts[]>(
        `/session/${sid}/message`,
        directory,
      );
      if (stale()) return;
      dispatch({ kind: "init", messages: Array.isArray(rows) ? rows : [] });
      const statuses = await ocJson<Record<string, SessionStatus>>(
        "/session/status",
        directory,
      );
      if (stale()) return;
      if (statuses[sid]) dispatch({ kind: "status", status: statuses[sid] });

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

      // Recover pending permissions
      try {
        const pending = await ocJson<
          | Array<{
              id: string;
              sessionID: string;
              permission?: string;
              action?: string;
              patterns?: string[];
              resources?: string[];
            }>
          | { data?: Array<Record<string, unknown>> }
        >("/permission", directory);
        if (stale()) return;
        const list = Array.isArray(pending)
          ? pending
          : Array.isArray((pending as { data?: unknown[] })?.data)
            ? ((pending as { data: Array<Record<string, unknown>> }).data)
            : [];
        dispatch({
          kind: "permissionsSynced",
          requests: list
            .filter((p) => String(p.sessionID ?? "") === sid)
            .map((p) => ({
              id: String(p.id),
              version: "v1" as const,
              sessionID: String(p.sessionID),
              permission: String(
                (p as { permission?: string }).permission ??
                  (p as { action?: string }).action ??
                  "permission",
              ),
              patterns: ((p as { patterns?: string[] }).patterns ??
                (p as { resources?: string[] }).resources ??
                []) as string[],
              receivedAt: Date.now(),
            })),
        });
      } catch {
        /* non-fatal */
      }

      // Recover pending questions missed while disconnected
      try {
        const pending = await ocJson<
          | Array<{
              id: string;
              sessionID: string;
              questions: QuestionInfo[];
            }>
          | { data?: Array<{ id: string; sessionID: string; questions: QuestionInfo[] }> }
        >("/question", directory);
        if (stale()) return;
        const list = Array.isArray(pending)
          ? pending
          : Array.isArray(pending?.data)
            ? pending.data
            : [];
        dispatch({
          kind: "questionsSynced",
          requests: list
            .filter((q) => q.sessionID === sid)
            .map((q) => ({
              id: q.id,
              version: "v1" as const,
              sessionID: q.sessionID,
              questions: q.questions ?? [],
              receivedAt: Date.now(),
            })),
        });
      } catch {
        /* non-fatal: SSE will deliver question.asked */
      }

      if (!stale()) dispatch({ kind: "sessionError", message: null });
    } catch (err) {
      if (stale()) return;
      dispatch({
        kind: "sessionError",
        message: err instanceof Error ? err.message : "読み込みに失敗しました",
      });
    }
  }, [directory]);

  useEffect(() => {
    if (!directory || !sessionId) return;

    const effectScope = `${directory}\u0000${sessionId}`;
    let cancelled = false;
    let es: EventSource | null = null;
    let retryMs = 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;

    void resync();

    const handleEvent = (raw: string) => {
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
        if (info && info.sessionID === sid) {
          dispatch({ kind: "messageUpdated", info });
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
      if (type === "session.status") {
        if (props.sessionID === sid && props.status) {
          dispatch({ kind: "status", status: props.status as SessionStatus });
        }
        return;
      }
      if (type === "session.idle") {
        if (props.sessionID === sid) {
          dispatch({ kind: "status", status: { type: "idle" } });
        }
        return;
      }
      if (type === "session.error") {
        const err = props.error as { data?: { message?: string } } | undefined;
        if (!props.sessionID || props.sessionID === sid) {
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
        const requestId = String(props.requestID ?? props.id ?? "");
        if (requestId) dispatch({ kind: "questionReplied", requestId });
        return;
      }
    };

    const connect = (isReconnect: boolean) => {
      if (cancelled) return;
      es?.close();
      dispatch({
        kind: "connection",
        connection: isReconnect ? "reconnecting" : "connecting",
      });
      es = new EventSource(apiUrl("/api/opencode/event", { directory }));

      es.onopen = () => {
        retryMs = 1000;
        dispatch({ kind: "connection", connection: "live" });
        if (isReconnect) void resync();
      };
      es.onmessage = (ev) => handleEvent(ev.data);
      es.onerror = () => {
        es?.close();
        dispatch({ kind: "connection", connection: "reconnecting" });
        timer = setTimeout(() => connect(true), retryMs);
        retryMs = Math.min(retryMs * 2, 15_000);
      };
    };

    connect(false);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [directory, sessionId, resync]);

  const sendPrompt = useCallback(
    async (
      text: string,
      opts?: {
        agent?: string;
        model?: { providerID: string; modelID: string };
        variant?: "high" | "low";
      },
    ) => {
      const sid = sessionRef.current;
      if (!directory || !sid) throw new Error("session not ready");
      const body: Record<string, unknown> = {
        parts: [{ type: "text", text }],
      };
      if (opts?.agent?.trim()) body.agent = opts.agent.trim();
      if (opts?.model?.providerID && opts.model.modelID) {
        body.model = opts.model;
      }
      if (opts?.variant) {
        body.variant = opts.variant;
      }
      await ocJson(`/session/${sid}/prompt_async`, directory, {
        method: "POST",
        body,
      });
      // safety net: events normally arrive first, resync fills any gap
      setTimeout(() => void resync(), 800);
    },
    [directory, resync],
  );

  const abort = useCallback(async () => {
    const sid = sessionRef.current;
    if (!directory || !sid) return;
    await ocJson(`/session/${sid}/abort`, directory, { method: "POST" });
  }, [directory]);

  const replyPermission = useCallback(
    async (request: PermissionRequest, response: "once" | "always" | "reject") => {
      if (!directory) return;
      try {
        if (request.version === "v2") {
          await ocJson(
            `/api/session/${request.sessionID}/permission/${request.id}/reply`,
            directory,
            { method: "POST", body: { reply: response } },
          );
        } else {
          await ocJson(
            `/session/${request.sessionID}/permissions/${request.id}`,
            directory,
            { method: "POST", body: { response } },
          );
        }
      } catch (err) {
        // 404 = already answered elsewhere; drop it from the queue either way
        if (!(err instanceof Error && /404/.test(err.message))) throw err;
      }
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
            { method: "POST", body: { answers } },
          );
        } else {
          await ocJson(`/question/${request.id}/reply`, directory, {
            method: "POST",
            body: { answers },
          });
        }
      } catch (err) {
        if (!(err instanceof Error && /404/.test(err.message))) throw err;
      }
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
            { method: "POST" },
          );
        } else {
          await ocJson(`/question/${request.id}/reject`, directory, {
            method: "POST",
          });
        }
      } catch (err) {
        if (!(err instanceof Error && /404/.test(err.message))) throw err;
      }
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
    abort,
    replyPermission,
    replyQuestion,
    rejectQuestion,
  };
}
