"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { apiUrl, ocJson } from "./client";
import type {
  MessageInfo,
  MessageWithParts,
  Part,
  PermissionRequest,
  SessionStatus,
  Todo,
} from "./types";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "down";

type StreamState = {
  messages: MessageWithParts[];
  status: SessionStatus | null;
  permissions: PermissionRequest[];
  todos: Todo[];
  connection: ConnectionState;
  sessionError: string | null;
  loaded: boolean;
};

type Action =
  | { kind: "init"; messages: MessageWithParts[] }
  | { kind: "messageUpdated"; info: MessageInfo }
  | { kind: "partUpdated"; part: Part }
  | { kind: "status"; status: SessionStatus }
  | { kind: "permissionAsked"; request: PermissionRequest }
  | { kind: "permissionReplied"; requestId: string }
  | { kind: "todos"; todos: Todo[] }
  | { kind: "connection"; connection: ConnectionState }
  | { kind: "sessionError"; message: string | null };

const initialState: StreamState = {
  messages: [],
  status: null,
  permissions: [],
  todos: [],
  connection: "connecting",
  sessionError: null,
  loaded: false,
};

function upsertPart(parts: Part[], part: Part): Part[] {
  const idx = parts.findIndex((p) => p.id === part.id);
  if (idx === -1) return [...parts, part];
  const next = parts.slice();
  next[idx] = part;
  return next;
}

function reducer(state: StreamState, action: Action): StreamState {
  switch (action.kind) {
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
    case "todos":
      return { ...state, todos: action.todos };
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
  const [state, dispatch] = useReducer(reducer, initialState);
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  const resync = useCallback(async () => {
    const sid = sessionRef.current;
    if (!directory || !sid) return;
    try {
      const rows = await ocJson<MessageWithParts[]>(
        `/session/${sid}/message`,
        directory,
      );
      dispatch({ kind: "init", messages: Array.isArray(rows) ? rows : [] });
      const statuses = await ocJson<Record<string, SessionStatus>>(
        "/session/status",
        directory,
      );
      if (statuses[sid]) dispatch({ kind: "status", status: statuses[sid] });
      dispatch({ kind: "sessionError", message: null });
    } catch (err) {
      dispatch({
        kind: "sessionError",
        message: err instanceof Error ? err.message : "読み込みに失敗しました",
      });
    }
  }, [directory]);

  useEffect(() => {
    if (!directory || !sessionId) return;

    let cancelled = false;
    let es: EventSource | null = null;
    let retryMs = 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;

    void resync();

    const handleEvent = (raw: string) => {
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

  return { ...state, resync, sendPrompt, abort, replyPermission };
}
