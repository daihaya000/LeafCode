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

type RestPermission = {
  id: string;
  sessionID: string;
  permission?: string;
  action?: string;
  patterns?: string[];
  resources?: string[];
};

function toQuestionItem(
  directory: string,
  q: RestQuestion,
  version: "v1" | "v2" = "v1",
): AttentionItem {
  return {
    kind: "question",
    directory,
    request: {
      id: q.id,
      version,
      sessionID: q.sessionID,
      questions: q.questions ?? [],
      receivedAt: Date.now(),
    },
  };
}

function toPermissionItem(
  directory: string,
  p: RestPermission,
  version: "v1" | "v2" = "v1",
): AttentionItem {
  return {
    kind: "permission",
    directory,
    request: {
      id: p.id,
      version,
      sessionID: p.sessionID,
      permission: p.permission ?? p.action ?? "permission",
      patterns: p.patterns ?? p.resources ?? [],
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

  const syncPendingAttention = useCallback(async () => {
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
        let questionsOk = false;
        let permissionsOk = false;
        let questions: RestQuestion[] = [];
        let permissions: RestPermission[] = [];
        try {
          const list = await ocJson<RestQuestion[]>("/question", directory);
          questions = Array.isArray(list) ? list : [];
          questionsOk = true;
        } catch {
          /* leave questions unsynced for this directory */
        }
        try {
          const list = await ocJson<RestPermission[]>("/permission", directory);
          permissions = Array.isArray(list) ? list : [];
          permissionsOk = true;
        } catch {
          /* leave permissions unsynced for this directory */
        }
        if (!questionsOk && !permissionsOk) return;

        const sessionIds = [
          ...new Set(
            tasks
              .filter((t) => t.directory === directory && t.sessionId)
              .map((t) => t.sessionId as string),
          ),
        ];
        const v2Permissions: AttentionItem[] = [];
        const v2Questions: AttentionItem[] = [];
        await Promise.allSettled(
          sessionIds.map(async (sessionID) => {
            const [pq, pp] = await Promise.all([
              ocJson<RestQuestion[]>(
                `/api/session/${sessionID}/question`,
                directory,
              ).catch(() => null),
              ocJson<RestPermission[]>(
                `/api/session/${sessionID}/permission`,
                directory,
              ).catch(() => null),
            ]);
            if (Array.isArray(pq)) {
              for (const q of pq) {
                v2Questions.push(
                  toQuestionItem(
                    directory,
                    { ...q, sessionID: q.sessionID || sessionID },
                    "v2",
                  ),
                );
              }
            }
            if (Array.isArray(pp)) {
              for (const p of pp) {
                v2Permissions.push(
                  toPermissionItem(
                    directory,
                    { ...p, sessionID: p.sessionID || sessionID },
                    "v2",
                  ),
                );
              }
            }
          }),
        );
        const questionById = new Map<string, AttentionItem>();
        if (questionsOk) {
          for (const q of questions.map((q) => toQuestionItem(directory, q))) {
            questionById.set(q.request.id, q);
          }
          for (const q of v2Questions) questionById.set(q.request.id, q);
        }
        const permissionById = new Map<string, AttentionItem>();
        if (permissionsOk) {
          for (const p of permissions.map((p) =>
            toPermissionItem(directory, p, "v1"),
          )) {
            permissionById.set(p.request.id, p);
          }
          for (const p of v2Permissions) permissionById.set(p.request.id, p);
        }
        reconcileDirectory(
          directory,
          questionsOk ? [...questionById.values()] : undefined,
          syncStartedAt,
          permissionsOk ? [...permissionById.values()] : undefined,
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
        void syncPendingAttention();
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
  }, [add, remove, syncPendingAttention]);

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
