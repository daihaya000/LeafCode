"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { apiUrl, getJson, ocJson } from "@/lib/client";
import { notifyAttentionCountChanged } from "@/lib/events";
import { parseGlobalEvent, isResolvedEvent, type AttentionItem, type AttentionScope } from "@/lib/attention";
import type { QuestionInfo, TaskSummary } from "@/lib/types";
import { useAttentionQueue } from "@/lib/useAttentionQueue";

type GlobalAttentionContextValue = {
  items: AttentionItem[];
  open: boolean;
  setOpen: (open: boolean) => void;
  openNext: () => void;
  remove: (requestId: string) => void;
};

const GlobalAttentionContext = createContext<GlobalAttentionContextValue | null>(null);

export function useGlobalAttention() {
  const ctx = useContext(GlobalAttentionContext);
  if (!ctx) throw new Error("useGlobalAttention requires GlobalAttentionProvider");
  return ctx;
}

type RestQuestion = {
  id: string;
  sessionID: string;
  questions?: QuestionInfo[];
};

function toQuestionItem(directory: string, q: RestQuestion): AttentionItem {
  return {
    kind: "question",
    directory,
    request: {
      id: q.id,
      version: "v1",
      sessionID: q.sessionID,
      questions: q.questions ?? [],
      receivedAt: Date.now(),
    },
  };
}

export function GlobalAttentionProvider({
  children,
  activeScope,
}: {
  children: React.ReactNode;
  activeScope: AttentionScope | null;
}) {
  const { items, add, remove, reconcileDirectory } = useAttentionQueue(activeScope);
  const [open, setOpenState] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const autoOpenedRef = useRef(false);
  const previousItemCountRef = useRef(0);

  const setOpen = useCallback((next: boolean) => {
    if (!next) autoOpenedRef.current = true;
    setOpenState(next);
  }, []);

  const openNext = useCallback(() => {
    if (items.length === 0) return;
    autoOpenedRef.current = true;
    setOpenState(true);
  }, [items.length]);

  const syncPendingQuestions = useCallback(async () => {
    const syncStartedAt = Date.now();
    let tasks: TaskSummary[];
    try {
      const data = await getJson<{ tasks: TaskSummary[] }>("/api/tasks");
      tasks = data.tasks ?? [];
    } catch {
      return;
    }
    const directories = [...new Set(tasks.map((t) => t.directory).filter(Boolean))];
    await Promise.allSettled(
      directories.map(async (directory) => {
        const list = await ocJson<RestQuestion[]>("/question", directory);
        reconcileDirectory(
          directory,
          list.map((q) => toQuestionItem(directory, q)),
          syncStartedAt,
        );
      }),
    );
  }, [reconcileDirectory]);

  // Notify badge subscribers whenever queue length changes
  useEffect(() => {
    notifyAttentionCountChanged();
  }, [items.length]);

  // Auto-open for new queue items. While the user is editing, defer until focus leaves.
  useEffect(() => {
    const previousItemCount = previousItemCountRef.current;
    previousItemCountRef.current = items.length;
    if (items.length === 0) {
      autoOpenedRef.current = false;
      return;
    }
    if (items.length > previousItemCount) autoOpenedRef.current = false;
    if (autoOpenedRef.current) return;

    const hasEditingFocus = () => {
      const focused = document.activeElement;
      return (
        focused instanceof HTMLInputElement ||
        focused instanceof HTMLTextAreaElement ||
        focused?.getAttribute("contenteditable") === "true"
      );
    };
    const tryAutoOpen = () => {
      if (autoOpenedRef.current || hasEditingFocus()) return false;
      autoOpenedRef.current = true;
      setOpenState(true);
      return true;
    };

    if (tryAutoOpen()) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const onFocusOut = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (tryAutoOpen()) window.removeEventListener("focusout", onFocusOut);
      }, 0);
    };
    window.addEventListener("focusout", onFocusOut);
    return () => {
      window.removeEventListener("focusout", onFocusOut);
      if (timer) clearTimeout(timer);
    };
  }, [items.length]);

  // Global EventSource subscription
  useEffect(() => {
    let es: EventSource | null = null;
    let retryMs = 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const connect = (isReconnect: boolean) => {
      void isReconnect;
      if (cancelled) return;
      es?.close();
      es = new EventSource(apiUrl("/api/opencode/global/event"));
      es.onmessage = (ev) => {
        const resolvedId = isResolvedEvent(ev.data);
        if (resolvedId) {
          remove(resolvedId);
          return;
        }
        const item = parseGlobalEvent(ev.data);
        if (item) add(item);
      };
      es.onopen = () => {
        retryMs = 1000;
        void syncPendingQuestions();
      };
      es.onerror = () => {
        es?.close();
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
  }, [add, syncPendingQuestions]);

  const value = {
    items,
    open,
    setOpen,
    openNext,
    remove,
  };

  return (
    <GlobalAttentionContext.Provider value={value}>
      {children}
    </GlobalAttentionContext.Provider>
  );
}
