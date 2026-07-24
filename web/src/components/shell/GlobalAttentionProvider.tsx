"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiUrl, getJson, ocJson } from "@/lib/client";
import { isSseSilent, SSE_SILENCE_MS } from "@/lib/sse-health";
import { notifyAttentionCountChanged } from "@/lib/events";
import {
  parseGlobalEvent,
  isResolvedEvent,
  normalizeOcList,
  replyPath,
  type AttentionItem,
  type AttentionScope,
} from "@/lib/attention";
import {
  isActionableAttentionPermission,
  permissionAutoAction,
  readSubagentPermission,
  SUBAGENT_PERMISSION_EVENT,
  type SubagentPermission,
} from "@/lib/subagent-permission";
import { SESSION_MUTATION_TIMEOUT_MS } from "@/lib/useSessionStream";
import type { QuestionInfo, TaskSummary } from "@/lib/types";
import { useAttentionQueue } from "@/lib/useAttentionQueue";

type GlobalAttentionContextValue = {
  items: AttentionItem[];
  /** Badge / modal 用。自動 reject 中の task 権限は除く（失敗分は含む）。 */
  actionableItems: AttentionItem[];
  open: boolean;
  setOpen: (open: boolean) => void;
  openNext: () => void;
  remove: (requestId: string, sessionID?: string) => void;
  resolveSessionTitle: (item: AttentionItem) => string | null;
};

const GlobalAttentionContext = createContext<GlobalAttentionContextValue | null>(null);

export function useGlobalAttention() {
  const ctx = useContext(GlobalAttentionContext);
  if (!ctx) throw new Error("useGlobalAttention requires GlobalAttentionProvider");
  return ctx;
}

/** Safe for components that may render outside the provider (e.g. unit tests). */
export function useOptionalGlobalAttention() {
  return useContext(GlobalAttentionContext);
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
  children: ReactNode;
  activeScope: AttentionScope | null;
}) {
  const { items, add, remove, reconcileDirectory, resolveSessionTitle, setTasks } =
    useAttentionQueue(activeScope);
  const [open, setOpenState] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const autoOpenedRef = useRef(false);
  const previousItemIdsRef = useRef<Set<string>>(new Set());

  const setOpen = useCallback((next: boolean) => {
    if (!next) autoOpenedRef.current = true;
    setOpenState(next);
  }, []);

  // バックグラウンドタスクの task 権限もサブエージェント不許可で自動 reject。
  // TaskView の auto-reply はアクティブセッションにしか効かないため、ここで補完する。
  const autoRejectIdsRef = useRef(new Set<string>());
  const [autoRejectFailedIds, setAutoRejectFailedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [subagentPermission, setSubagentPermission] = useState<SubagentPermission>(
    () => readSubagentPermission(),
  );
  useEffect(() => {
    const onSubagent = (e: Event) => {
      const detail = (e as CustomEvent<SubagentPermission>).detail;
      if (detail === "allow" || detail === "deny") setSubagentPermission(detail);
    };
    window.addEventListener(SUBAGENT_PERMISSION_EVENT, onSubagent);
    return () =>
      window.removeEventListener(SUBAGENT_PERMISSION_EVENT, onSubagent);
  }, []);

  const actionableItems = useMemo(() => {
    return items.filter((item) => {
      if (item.kind !== "permission") return true;
      return isActionableAttentionPermission(
        item.request.permission,
        subagentPermission,
        item.request.id,
        autoRejectFailedIds,
      );
    });
  }, [items, subagentPermission, autoRejectFailedIds]);

  useEffect(() => {
    if (subagentPermission !== "deny") {
      autoRejectIdsRef.current.clear();
      setAutoRejectFailedIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    for (const item of items) {
      if (item.kind !== "permission") continue;
      if (autoRejectIdsRef.current.has(item.request.id)) continue;
      if (autoRejectFailedIds.has(item.request.id)) continue;
      const action = permissionAutoAction({
        permission: item.request.permission,
        subagent: subagentPermission,
        fullAccess: false,
      });
      if (action !== "reject") continue;
      autoRejectIdsRef.current.add(item.request.id);
      void ocJson(replyPath(item), item.directory, {
        method: "POST",
        body:
          item.request.version === "v2"
            ? { reply: "reject" }
            : { response: "reject" },
        timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
      })
        .then(() => {
          setAutoRejectFailedIds((prev) => {
            if (!prev.has(item.request.id)) return prev;
            const next = new Set(prev);
            next.delete(item.request.id);
            return next;
          });
          remove(item.request.id, item.request.sessionID);
        })
        .catch(() => {
          autoRejectIdsRef.current.delete(item.request.id);
          setAutoRejectFailedIds((prev) => {
            if (prev.has(item.request.id)) return prev;
            const next = new Set(prev);
            next.add(item.request.id);
            return next;
          });
        });
    }
  }, [autoRejectFailedIds, items, remove, subagentPermission]);

  const openNext = useCallback(() => {
    if (actionableItems.length === 0) return;
    autoOpenedRef.current = true;
    setOpenState(true);
  }, [actionableItems.length]);

  const syncPendingAttention = useCallback(async () => {
    const syncStartedAt = Date.now();
    let tasks: TaskSummary[];
    try {
      const data = await getJson<{ tasks: TaskSummary[] }>("/api/tasks");
      tasks = data.tasks ?? [];
      setTasks(tasks);
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
          const list = await ocJson<unknown>("/question", directory);
          questions = normalizeOcList<RestQuestion>(list);
          questionsOk = true;
        } catch {
          /* leave questions unsynced for this directory */
        }
        try {
          const list = await ocJson<unknown>("/permission", directory);
          permissions = normalizeOcList<RestPermission>(list);
          permissionsOk = true;
        } catch {
          /* leave permissions unsynced for this directory */
        }

        const sessionIds = [
          ...new Set(
            tasks
              .filter((t) => t.directory === directory && t.sessionId)
              .map((t) => t.sessionId as string),
          ),
        ];
        const v2Permissions: AttentionItem[] = [];
        const v2Questions: AttentionItem[] = [];
        let v2QuestionsFetched = false;
        let v2PermissionsFetched = false;
        await Promise.allSettled(
          sessionIds.map(async (sessionID) => {
            const [pq, pp] = await Promise.all([
              ocJson<unknown>(
                `/api/session/${sessionID}/question`,
                directory,
              ).catch(() => null),
              ocJson<unknown>(
                `/api/session/${sessionID}/permission`,
                directory,
              ).catch(() => null),
            ]);
            if (pq !== null) {
              v2QuestionsFetched = true;
              for (const q of normalizeOcList<RestQuestion>(pq)) {
                v2Questions.push(
                  toQuestionItem(
                    directory,
                    { ...q, sessionID: q.sessionID || sessionID },
                    "v2",
                  ),
                );
              }
            }
            if (pp !== null) {
              v2PermissionsFetched = true;
              for (const p of normalizeOcList<RestPermission>(pp)) {
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

        // Merge v2 even when v1 failed (parity with useSessionStream).
        const syncQuestions = questionsOk || v2QuestionsFetched;
        const syncPermissions = permissionsOk || v2PermissionsFetched;
        if (!syncQuestions && !syncPermissions) return;

        const questionById = new Map<string, AttentionItem>();
        if (questionsOk) {
          for (const q of questions.map((q) => toQuestionItem(directory, q))) {
            questionById.set(q.request.id, q);
          }
        }
        for (const q of v2Questions) questionById.set(q.request.id, q);

        const permissionById = new Map<string, AttentionItem>();
        if (permissionsOk) {
          for (const p of permissions.map((p) =>
            toPermissionItem(directory, p, "v1"),
          )) {
            permissionById.set(p.request.id, p);
          }
        }
        for (const p of v2Permissions) permissionById.set(p.request.id, p);

        reconcileDirectory(
          directory,
          syncQuestions ? [...questionById.values()] : undefined,
          syncStartedAt,
          syncPermissions ? [...permissionById.values()] : undefined,
        );
      }),
    );
  }, [reconcileDirectory, setTasks]);

  // Notify badge subscribers whenever queue length changes
  useEffect(() => {
    notifyAttentionCountChanged();
  }, [actionableItems.length]);

  // Auto-open for new queue items. While the user is editing, defer until focus leaves.
  useEffect(() => {
    // Track previous item IDs to detect new arrivals even when count stays same
    // (e.g., 1 resolved + 1 arrived simultaneously)
    const previousIds = previousItemIdsRef.current;
    const currentIds = new Set(actionableItems.map((item) => item.request.id));
    previousItemIdsRef.current = currentIds;

    if (actionableItems.length === 0) {
      autoOpenedRef.current = false;
      return;
    }

    // Check if any new IDs appeared (not just count increase)
    const hasNewItems = actionableItems.some((item) => !previousIds.has(item.request.id));
    if (hasNewItems) autoOpenedRef.current = false;

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
  }, [actionableItems]);

  // Global EventSource subscription
  useEffect(() => {
    let es: EventSource | null = null;
    let retryMs = 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let lastActivityAt = Date.now();

    const markActivity = () => {
      lastActivityAt = Date.now();
    };

    const connect = (isReconnect: boolean) => {
      void isReconnect;
      if (cancelled) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (es) {
        es.onerror = null;
        es.close();
      }
      es = new EventSource(apiUrl("/api/opencode/global/event"));
      es.onmessage = (ev) => {
        markActivity();
        const resolved = isResolvedEvent(ev.data);
        if (resolved) {
          remove(resolved.requestId, resolved.sessionID);
          return;
        }
        const item = parseGlobalEvent(ev.data);
        if (item) add(item);
      };
      es.addEventListener("heartbeat", () => {
        markActivity();
      });
      es.onopen = () => {
        markActivity();
        retryMs = 1000;
        void syncPendingAttention();
      };
      es.onerror = () => {
        if (cancelled) return;
        es?.close();
        timer = setTimeout(() => connect(true), retryMs);
        retryMs = Math.min(retryMs * 2, 15_000);
      };
    };

    const silenceWatch = setInterval(() => {
      if (cancelled || !es || es.readyState !== EventSource.OPEN) return;
      if (!isSseSilent(lastActivityAt, Date.now(), SSE_SILENCE_MS)) return;
      connect(true);
    }, 5_000);

    const onOnline = () => {
      if (cancelled) return;
      markActivity();
      connect(true);
    };
    window.addEventListener("online", onOnline);

    connect(false);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearInterval(silenceWatch);
      window.removeEventListener("online", onOnline);
      es?.close();
    };
  }, [add, remove, syncPendingAttention]);

  // Leaving or switching the active task must restore pending attention into
  // the global queue (setActiveScope only filters items out, never back in).
  const prevScopeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = activeScope
      ? `${activeScope.directory}\u0000${activeScope.sessionId}`
      : "";
    const prev = prevScopeKeyRef.current;
    prevScopeKeyRef.current = key;
    if (prev === null) return; // skip first mount — onopen sync covers it
    if (prev === key) return;
    void syncPendingAttention();
  }, [activeScope, syncPendingAttention]);

  const value = {
    items,
    actionableItems,
    open,
    setOpen,
    openNext,
    remove,
    resolveSessionTitle,
  };

  return (
    <GlobalAttentionContext.Provider value={value}>
      {children}
    </GlobalAttentionContext.Provider>
  );
}
