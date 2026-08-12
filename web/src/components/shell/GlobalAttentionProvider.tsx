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
import { apiUrl, getJson, ocJson, sendJson } from "@/lib/client";
import {
  isSseConnectStalled,
  isSseSilent,
  SSE_SILENCE_MS,
} from "@/lib/sse-health";
import { notifyAttentionCountChanged } from "@/lib/events";
import {
  parseGlobalEvent,
  parseGlobalSessionCreated,
  isResolvedEvent,
  normalizeOcList,
  replyPath,
  attentionItemKey,
  type AttentionItem,
  type AttentionScope,
} from "@/lib/attention";
import {
  ACCESS_MODE_EVENT,
  ACCESS_MODE_STORAGE_KEY,
  readAccessMode,
  type AccessMode,
} from "@/lib/access-mode";
import {
  isActionableAttentionPermission,
  permissionAutoAction,
  readSubagentPermission,
  SUBAGENT_PERMISSION_EVENT,
  SUBAGENT_PERMISSION_STORAGE_KEY,
  type SubagentPermission,
} from "@/lib/subagent-permission";
import {
  readSkillPermission,
  SKILL_PERMISSION_EVENT,
  SKILL_PERMISSION_STORAGE_KEY,
  type SkillPermission,
} from "@/lib/skill-permission";
import { shouldSyncAccessCeilingForSessionCreated } from "@/lib/opencode-access-mode";
import { activeEventPath } from "@/lib/opencode-paths";
import { SESSION_MUTATION_TIMEOUT_MS } from "@/lib/useSessionStream";
import { wasRecentlyReplied } from "@/lib/recently-replied";
import type { QuestionInfo, TaskSummary } from "@/lib/types";
import { useAttentionQueue } from "@/lib/useAttentionQueue";

type GlobalAttentionContextValue = {
  items: AttentionItem[];
  /** Badge / modal 用。自動 reject 中の task / skill 権限は除く（失敗分は含む）。 */
  actionableItems: AttentionItem[];
  open: boolean;
  setOpen: (open: boolean) => void;
  openNext: () => void;
  remove: (requestId: string, sessionID?: string) => void;
  resolveSessionTitle: (item: AttentionItem) => string | null;
  tasks: TaskSummary[];
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

type RestChildSession = {
  id?: string;
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

/** Match access-mode ceiling depth so nested subagents stay in the permission poll. */
const MAX_ATTENTION_DESCENDANT_DEPTH = 8;

async function directChildSessionIdsFor(
  directory: string,
  parentSessionID: string,
): Promise<string[]> {
  try {
    const list = await ocJson<unknown>(
      `/session/${parentSessionID}/children`,
      directory,
    );
    return normalizeOcList<RestChildSession>(list)
      .map((child) => child.id)
      .filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
}

/**
 * Breadth-first descendants (not including the parent).
 * Direct `/children` alone misses grandchildren that now receive the edit
 * ceiling and emit permission.asked — without these ids, v2 REST restore
 * after reconnect drops nested approval cards.
 */
async function descendantSessionIdsFor(
  directory: string,
  parentSessionID: string,
  maxDepth: number = MAX_ATTENTION_DESCENDANT_DEPTH,
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>([parentSessionID]);
  let frontier = [parentSessionID];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      const children = await directChildSessionIdsFor(directory, id);
      for (const child of children) {
        if (!child || seen.has(child)) continue;
        seen.add(child);
        out.push(child);
        next.push(child);
      }
    }
    frontier = next;
  }
  return out;
}

export function GlobalAttentionProvider({
  children,
  activeScope,
}: {
  children: ReactNode;
  activeScope: AttentionScope | null;
}) {
  const { items, add, remove, reconcileDirectory, resolveSessionTitle, setTasks, tasks } =
    useAttentionQueue(activeScope);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  /** Per root session: descendant ids seen via global session.created. */
  const knownDescendantsByRootRef = useRef(new Map<string, Set<string>>());
  const [open, setOpenState] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const autoOpenedRef = useRef(false);
  const previousItemIdsRef = useRef<Set<string>>(new Set());

  const setOpen = useCallback((next: boolean) => {
    if (!next) autoOpenedRef.current = true;
    setOpenState(next);
  }, []);

  // バックグラウンド権限も TaskView と同じ permissionAutoAction で自動処理。
  // （サブエージェント / スキル不許可 → reject、フルアクセス → approve）
  const autoReplyIdsRef = useRef(new Set<string>());
  const [autoReplyFailedIds, setAutoReplyFailedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [subagentPermission, setSubagentPermission] = useState<SubagentPermission>(
    () => readSubagentPermission(),
  );
  const [skillPermission, setSkillPermission] = useState<SkillPermission>(
    () => readSkillPermission(),
  );
  const [accessMode, setAccessMode] = useState<AccessMode>(() => readAccessMode());
  useEffect(() => {
    const onSubagent = (e: Event) => {
      const detail = (e as CustomEvent<SubagentPermission>).detail;
      if (detail === "allow" || detail === "deny") setSubagentPermission(detail);
    };
    const onAccess = (e: Event) => {
      const detail = (e as CustomEvent<AccessMode>).detail;
      if (detail === "ask" || detail === "full") setAccessMode(detail);
    };
    const onSkill = (e: Event) => {
      const detail = (e as CustomEvent<SkillPermission>).detail;
      if (detail === "allow" || detail === "deny") setSkillPermission(detail);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACCESS_MODE_STORAGE_KEY) {
        if (e.newValue === "ask" || e.newValue === "full") setAccessMode(e.newValue);
        else if (e.newValue == null) setAccessMode(readAccessMode());
      }
      if (e.key === SUBAGENT_PERMISSION_STORAGE_KEY) {
        if (e.newValue === "allow" || e.newValue === "deny") {
          setSubagentPermission(e.newValue);
        } else if (e.newValue == null) {
          setSubagentPermission(readSubagentPermission());
        }
      }
      if (e.key === SKILL_PERMISSION_STORAGE_KEY) {
        if (e.newValue === "allow" || e.newValue === "deny") {
          setSkillPermission(e.newValue);
        } else if (e.newValue == null) {
          setSkillPermission(readSkillPermission());
        }
      }
    };
    window.addEventListener(SUBAGENT_PERMISSION_EVENT, onSubagent);
    window.addEventListener(SKILL_PERMISSION_EVENT, onSkill);
    window.addEventListener(ACCESS_MODE_EVENT, onAccess);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SUBAGENT_PERMISSION_EVENT, onSubagent);
      window.removeEventListener(SKILL_PERMISSION_EVENT, onSkill);
      window.removeEventListener(ACCESS_MODE_EVENT, onAccess);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const fullAccess = accessMode === "full";

  const actionableItems = useMemo(() => {
    return items.filter((item) => {
      if (item.kind !== "permission") return true;
      return isActionableAttentionPermission(
        item.request.permission,
        subagentPermission,
        skillPermission,
        item.request.id,
        fullAccess,
        autoReplyFailedIds,
        attentionItemKey(item),
      );
    });
  }, [items, subagentPermission, skillPermission, fullAccess, autoReplyFailedIds]);

  useEffect(() => {
    if (
      !fullAccess &&
      subagentPermission !== "deny" &&
      skillPermission !== "deny"
    ) {
      autoReplyIdsRef.current.clear();
      setAutoReplyFailedIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    for (const item of items) {
      if (item.kind !== "permission") continue;
      const itemKey = attentionItemKey(item);
      if (autoReplyIdsRef.current.has(itemKey)) continue;
      if (autoReplyFailedIds.has(itemKey)) continue;
      // TaskView / PermissionCard may already have answered the same id.
      if (wasRecentlyReplied(item.request.id, item.request.sessionID)) {
        remove(item.request.id, item.request.sessionID);
        continue;
      }
      const action = permissionAutoAction({
        permission: item.request.permission,
        subagent: subagentPermission,
        skill: skillPermission,
        fullAccess,
      });
      if (action === "manual") continue;
      autoReplyIdsRef.current.add(itemKey);
      const reply = action === "reject" ? "reject" : "once";
      void ocJson(replyPath(item), item.directory, {
        method: "POST",
        body:
          item.request.version === "v2"
            ? { reply }
            : { response: reply },
        timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
      })
        .then(() => {
          setAutoReplyFailedIds((prev) => {
            if (!prev.has(itemKey)) return prev;
            const next = new Set(prev);
            next.delete(itemKey);
            return next;
          });
          remove(item.request.id, item.request.sessionID);
        })
        .catch(() => {
          autoReplyIdsRef.current.delete(itemKey);
          setAutoReplyFailedIds((prev) => {
            if (prev.has(itemKey)) return prev;
            const next = new Set(prev);
            next.add(itemKey);
            return next;
          });
        });
    }
  }, [
    autoReplyFailedIds,
    fullAccess,
    items,
    remove,
    subagentPermission,
    skillPermission,
  ]);

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

        const rootSessionIds = [
          ...new Set(
            tasks
              .filter((t) => t.directory === directory && t.sessionId)
              .map((t) => t.sessionId as string),
          ),
        ];
        const descendantSessionIds = (
          await Promise.all(
            rootSessionIds.map((sessionID) =>
              descendantSessionIdsFor(directory, sessionID),
            ),
          )
        ).flat();
        const sessionIds = [
          ...new Set([...rootSessionIds, ...descendantSessionIds]),
        ];
        const v2Permissions: AttentionItem[] = [];
        const v2Questions: AttentionItem[] = [];
        const v2QuestionOkSessions = new Set<string>();
        const v2PermissionOkSessions = new Set<string>();
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
              v2QuestionOkSessions.add(sessionID);
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
              v2PermissionOkSessions.add(sessionID);
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
        // Partial v2 success must NOT drop pending items for sessions that
        // failed to fetch — keep those sessions' local SSE items.
        const syncQuestions =
          questionsOk || v2QuestionOkSessions.size > 0;
        const syncPermissions =
          permissionsOk || v2PermissionOkSessions.size > 0;
        if (!syncQuestions && !syncPermissions) return;

        const questionById = new Map<string, AttentionItem>();
        if (questionsOk) {
          for (const q of questions.map((q) => toQuestionItem(directory, q))) {
            questionById.set(`${q.request.sessionID}\u0000${q.request.id}`, q);
          }
        }
        for (const q of v2Questions) {
          questionById.set(`${q.request.sessionID}\u0000${q.request.id}`, q);
        }

        const permissionById = new Map<string, AttentionItem>();
        if (permissionsOk) {
          for (const p of permissions.map((p) =>
            toPermissionItem(directory, p, "v1"),
          )) {
            permissionById.set(`${p.request.sessionID}\u0000${p.request.id}`, p);
          }
        }
        for (const p of v2Permissions) {
          permissionById.set(`${p.request.sessionID}\u0000${p.request.id}`, p);
        }

        const keepQuestionSessionIds = questionsOk
          ? []
          : sessionIds.filter((id) => !v2QuestionOkSessions.has(id));
        const keepPermissionSessionIds = permissionsOk
          ? []
          : sessionIds.filter((id) => !v2PermissionOkSessions.has(id));

        reconcileDirectory(
          directory,
          syncQuestions ? [...questionById.values()] : undefined,
          syncStartedAt,
          syncPermissions ? [...permissionById.values()] : undefined,
          { keepQuestionSessionIds, keepPermissionSessionIds },
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
    const currentIds = new Set(actionableItems.map(attentionItemKey));
    previousItemIdsRef.current = currentIds;

    if (actionableItems.length === 0) {
      autoOpenedRef.current = false;
      return;
    }

    // Check if any new IDs appeared (not just count increase)
    const hasNewItems = actionableItems.some((item) => !previousIds.has(attentionItemKey(item)));
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
    /** When the current EventSource attempt started — drives the connect-stall guard. */
    let connectStartedAt = Date.now();

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
      connectStartedAt = Date.now();
      es = new EventSource(apiUrl(`/api/opencode${activeEventPath()}`));
      es.onmessage = (ev) => {
        markActivity();
        const resolved = isResolvedEvent(ev.data);
        if (resolved) {
          remove(resolved.requestId, resolved.sessionID);
          return;
        }
        // TaskView is the usual owner of session.created → ensureSessionIds, but
        // it unmounts on Home / other tasks. Without this, background subagents
        // keep OpenCode's default edit:allow while the UI still says 確認する.
        const created = parseGlobalSessionCreated(ev.data);
        if (created) {
          const mode = readAccessMode();
          for (const task of tasksRef.current) {
            if (task.executionMode === "workflow") continue;
            if (!task.id || !task.sessionId || task.directory !== created.directory) {
              continue;
            }
            const rootKey = `${task.directory}\u0000${task.sessionId}`;
            let known = knownDescendantsByRootRef.current.get(rootKey);
            if (!known) {
              known = new Set();
              knownDescendantsByRootRef.current.set(rootKey, known);
            }
            const decision = shouldSyncAccessCeilingForSessionCreated({
              rootSessionId: task.sessionId,
              parentID: created.parentID,
              sessionID: created.sessionID,
              knownDescendants: known,
            });
            if (!decision.track) continue;
            known.add(decision.sessionID);
            void sendJson("POST", "/api/access-mode", {
              taskId: task.id,
              sessionId: task.sessionId,
              mode,
              ensureSessionIds: [decision.sessionID],
            }).catch(() => {
              /* non-fatal — next sync / TaskView remount can retry */
            });
          }
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
      if (cancelled || !es) return;
      if (es.readyState === EventSource.CONNECTING) {
        // A stalled engine can leave the stream in CONNECTING indefinitely; the
        // silence check below needs an OPEN stream and would never fire. Only
        // CONNECTING is retried here — CLOSED is already on the backoff timer.
        if (isSseConnectStalled(connectStartedAt, Date.now())) connect(true);
        return;
      }
      if (es.readyState !== EventSource.OPEN) return;
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
    tasks,
  };

  return (
    <GlobalAttentionContext.Provider value={value}>
      {children}
    </GlobalAttentionContext.Provider>
  );
}
