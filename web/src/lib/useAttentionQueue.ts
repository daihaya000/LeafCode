import { useCallback, useEffect, useReducer, useRef } from "react";
import { getJson } from "./client";
import type { AttentionItem, AttentionScope } from "./attention";
import { scopeKey } from "./attention";
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
      if (state.items.some((i) => i.request.id === action.item.request.id)) {
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
      const questionIds = new Set(
        (action.questions ?? []).map((q) => q.request.id),
      );
      const permissionIds = new Set(
        (action.permissions ?? []).map((p) => p.request.id),
      );
      const kept = state.items.filter((item) => {
        if (item.directory !== action.directory) return true;
        if (item.kind === "question") {
          if (!syncQuestions) return true;
          if (questionIds.has(item.request.id)) return true;
          return item.request.receivedAt > action.syncStartedAt;
        }
        if (item.kind === "permission") {
          if (!syncPermissions) return true;
          if (permissionIds.has(item.request.id)) return true;
          return item.request.receivedAt > action.syncStartedAt;
        }
        return true;
      });
      const keptIds = new Set(kept.map((i) => i.request.id));
      const additions = [
        ...(action.questions ?? []),
        ...(action.permissions ?? []),
      ].filter(
        (item) =>
          !keptIds.has(item.request.id) &&
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
    if (wasRecentlyReplied(item.request.id)) return;
    dispatch({ kind: "add", item });
  }, []);

  const remove = useCallback((requestId: string, sessionID?: string) => {
    rememberReplied(requestId);
    dispatch({ kind: "remove", requestId, sessionID });
  }, []);

  const reconcileDirectory = useCallback(
    (
      directory: string,
      questions: AttentionItem[] | undefined,
      syncStartedAt: number,
      permissions?: AttentionItem[],
    ) => {
      const drop = (items: AttentionItem[] | undefined) => {
        if (!items) return items;
        return items.filter((item) => !wasRecentlyReplied(item.request.id));
      };
      dispatch({
        kind: "reconcileDirectory",
        directory,
        questions: drop(questions),
        permissions: drop(permissions),
        syncStartedAt,
        activeScope: scopeRef.current,
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
