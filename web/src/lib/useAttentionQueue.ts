import { useCallback, useEffect, useReducer, useRef } from "react";
import { getJson } from "./client";
import type { AttentionItem, AttentionScope } from "./attention";
import { attentionItemKey, scopeKey } from "./attention";
import { rememberReplied, wasRecentlyReplied } from "./recently-replied";
import type { TaskSummary } from "./types";

export type AttentionQueueState = {
  items: AttentionItem[];
  tasks: TaskSummary[];
};

export type AttentionQueueAction =
  | { kind: "add"; item: AttentionItem }
  | { kind: "remove"; requestId: string; sessionID?: string }
  | { kind: "setActiveScope"; scope: AttentionScope | null }
  | { kind: "setTasks"; tasks: TaskSummary[] }
  | {
      kind: "reconcileDirectory";
      directory: string;
      questions?: AttentionItem[];
      permissions?: AttentionItem[];
      syncStartedAt: number;
      activeScope?: AttentionScope | null;
      /** Sessions whose v2 fetch failed — keep their local pending items. */
      keepQuestionSessionIds?: string[];
      keepPermissionSessionIds?: string[];
    };

export function shouldQueueAttention(
  item: AttentionItem,
  activeScope: AttentionScope | null,
): boolean {
  // Active session renders permission/question inline in TaskView — keep them
  // out of the global modal queue to avoid duplicate replies.
  if (!activeScope) return true;
  return `${item.directory}\u0000${item.request.sessionID}` !== scopeKey(activeScope);
}

/** Resolve a human-readable session title for an attention item. */
export function resolveAttentionSessionTitle(
  item: AttentionItem,
  tasks: TaskSummary[],
): string | null {
  const exact = tasks.find(
    (t) =>
      t.directory === item.directory &&
      t.sessionId === item.request.sessionID,
  );
  if (exact?.title.trim()) return exact.title.trim();
  const bySession = tasks.find((t) => t.sessionId === item.request.sessionID);
  if (bySession?.title.trim()) return bySession.title.trim();
  return null;
}

export function attentionQueueReducer(
  state: AttentionQueueState,
  action: AttentionQueueAction,
): AttentionQueueState {
  switch (action.kind) {
    case "add": {
      if (state.items.some((i) => attentionItemKey(i) === attentionItemKey(action.item))) {
        return state;
      }
      return { ...state, items: [...state.items, action.item] };
    }
    case "remove":
      return {
        ...state,
        items: state.items.filter((i) => {
          if (i.request.id !== action.requestId) return true;
          if (action.sessionID && i.request.sessionID !== action.sessionID) {
            return true;
          }
          return false;
        }),
      };
    case "setActiveScope": {
      if (!action.scope) return state;
      return {
        ...state,
        items: state.items.filter((item) => shouldQueueAttention(item, action.scope)),
      };
    }
    case "reconcileDirectory": {
      const syncQuestions = action.questions !== undefined;
      const syncPermissions = action.permissions !== undefined;
      const questionKeys = new Set(
        (action.questions ?? []).map((q) => `${q.request.sessionID}\u0000${q.request.id}`),
      );
      const permissionKeys = new Set(
        (action.permissions ?? []).map((p) => `${p.request.sessionID}\u0000${p.request.id}`),
      );
      const keepQ = new Set(action.keepQuestionSessionIds ?? []);
      const keepP = new Set(action.keepPermissionSessionIds ?? []);
      const kept = state.items.filter((item) => {
        if (item.directory !== action.directory) return true;
        if (item.kind === "question") {
          if (!syncQuestions) return true;
          // Prefer the sync copy for the same id (v1→v2 upgrade, parity with
          // useSessionStream permissionsSynced).
          if (questionKeys.has(`${item.request.sessionID}\u0000${item.request.id}`)) return false;
          if (keepQ.has(item.request.sessionID)) return true;
          return item.request.receivedAt > action.syncStartedAt;
        }
        if (item.kind === "permission") {
          if (!syncPermissions) return true;
          if (permissionKeys.has(`${item.request.sessionID}\u0000${item.request.id}`)) return false;
          if (keepP.has(item.request.sessionID)) return true;
          return item.request.receivedAt > action.syncStartedAt;
        }
        return true;
      });
      const keptKeys = new Set(
        kept.map(attentionItemKey),
      );
      const additions = [
        ...(action.questions ?? []),
        ...(action.permissions ?? []),
      ].filter(
        (item) =>
          !keptKeys.has(attentionItemKey(item)) &&
          shouldQueueAttention(item, action.activeScope ?? null),
      );
      return { ...state, items: [...kept, ...additions] };
    }
    case "setTasks":
      return { ...state, tasks: action.tasks };
    default:
      return state;
  }
}

export function useAttentionQueue(activeScope: AttentionScope | null) {
  const [state, dispatch] = useReducer(attentionQueueReducer, {
    items: [],
    tasks: [],
  });
  const scopeRef = useRef(activeScope);
  scopeRef.current = activeScope;

  const add = useCallback((item: AttentionItem) => {
    if (!shouldQueueAttention(item, scopeRef.current)) return;
    if (wasRecentlyReplied(item.request.id, item.request.sessionID)) return;
    dispatch({ kind: "add", item });
  }, []);

  const remove = useCallback((requestId: string, sessionID?: string) => {
    rememberReplied(requestId, sessionID);
    dispatch({ kind: "remove", requestId, sessionID });
  }, []);

  const reconcileDirectory = useCallback(
    (
      directory: string,
      questions: AttentionItem[] | undefined,
      syncStartedAt: number,
      permissions?: AttentionItem[],
      opts?: {
        keepQuestionSessionIds?: string[];
        keepPermissionSessionIds?: string[];
      },
    ) => {
      const drop = (items: AttentionItem[] | undefined) => {
        if (!items) return items;
        return items.filter(
          (item) => !wasRecentlyReplied(item.request.id, item.request.sessionID),
        );
      };
      dispatch({
        kind: "reconcileDirectory",
        directory,
        questions: drop(questions),
        permissions: drop(permissions),
        syncStartedAt,
        activeScope: scopeRef.current,
        keepQuestionSessionIds: opts?.keepQuestionSessionIds,
        keepPermissionSessionIds: opts?.keepPermissionSessionIds,
      });
    },
    [],
  );

  useEffect(() => {
    dispatch({ kind: "setActiveScope", scope: activeScope });
  }, [activeScope]);

  const refreshTasks = useCallback(async () => {
    try {
      const data = await getJson<{ tasks: TaskSummary[] }>("/api/tasks");
      dispatch({ kind: "setTasks", tasks: data.tasks ?? [] });
    } catch {
      /* ignore */
    }
  }, []);

  const setTasks = useCallback((tasks: TaskSummary[]) => {
    dispatch({ kind: "setTasks", tasks });
  }, []);

  useEffect(() => {
    void refreshTasks();
    const onChange = () => void refreshTasks();
    window.addEventListener("webui:tasks-changed", onChange);
    return () => window.removeEventListener("webui:tasks-changed", onChange);
  }, [refreshTasks]);

  const resolveTask = useCallback(
    (scope: AttentionScope): TaskSummary | undefined => {
      return state.tasks.find(
        (t) => t.directory === scope.directory && t.sessionId === scope.sessionId,
      );
    },
    [state.tasks],
  );

  const resolveSessionTitle = useCallback(
    (item: AttentionItem): string | null =>
      resolveAttentionSessionTitle(item, state.tasks),
    [state.tasks],
  );

  return {
    items: state.items,
    tasks: state.tasks,
    add,
    remove,
    reconcileDirectory,
    refreshTasks,
    setTasks,
    resolveTask,
    resolveSessionTitle,
  };
}
