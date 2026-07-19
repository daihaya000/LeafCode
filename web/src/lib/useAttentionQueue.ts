import { useCallback, useEffect, useReducer, useRef } from "react";
import { getJson } from "./client";
import type { AttentionItem, AttentionScope } from "./attention";
import { scopeKey } from "./attention";
import type { TaskSummary } from "./types";

export type AttentionQueueState = {
  items: AttentionItem[];
  tasks: TaskSummary[];
};

export type AttentionQueueAction =
  | { kind: "add"; item: AttentionItem }
  | { kind: "remove"; requestId: string }
  | { kind: "setActiveScope"; scope: AttentionScope | null }
  | { kind: "setTasks"; tasks: TaskSummary[] };

export function shouldQueueAttention(
  item: AttentionItem,
  activeScope: AttentionScope | null,
): boolean {
  if (!activeScope || item.kind === "question") return true;
  return `${item.directory}\u0000${item.request.sessionID}` !== scopeKey(activeScope);
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
        items: state.items.filter((i) => i.request.id !== action.requestId),
      };
    case "setActiveScope": {
      if (!action.scope) return state;
      return {
        ...state,
        items: state.items.filter((item) => shouldQueueAttention(item, action.scope)),
      };
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
    dispatch({ kind: "add", item });
  }, []);

  const remove = useCallback((requestId: string) => {
    dispatch({ kind: "remove", requestId });
  }, []);

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

  return {
    items: state.items,
    add,
    remove,
    refreshTasks,
    resolveTask,
  };
}
