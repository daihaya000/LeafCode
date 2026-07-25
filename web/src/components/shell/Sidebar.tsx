"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Cpu,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  Star,
  Trash2,
} from "lucide-react";
import { AddProjectButton } from "@/components/AddProjectButton";
import { AddonHost } from "@/components/addons/AddonHost";
import { ThemeToggle, cx, timeAgo } from "@/components/ui";
import { notifyTasksChanged } from "@/lib/events";
import { getJson, sendJson } from "@/lib/client";
import {
  getActiveSessionAttention,
  type ActiveSessionAttention,
} from "@/lib/active-session-attention";
import { formatCostValue, useCostDisplayPrefs } from "@/lib/currency";
import { providerIconSrcForOpencodeId } from "@addons/codexbar";
import { AttentionBadge } from "./AttentionBadge";
import { useGlobalAttention } from "./GlobalAttentionProvider";
import type { ProjectDto, TaskSummary } from "@/lib/types";

const EXPANDED_KEY = "webui.sidebar.expanded";
const WIDTH_KEY = "webui.sidebar.width";
const ARCHIVED_EXPANDED_KEY = "webui.sidebar.archived_expanded";
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 180;
const MAX_WIDTH = 480;
const ACTIVE_TASK_POLL_MS = 3000;

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveExpanded(ids: Set<string>) {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

function clampWidth(n: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(n)));
}

function loadWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (!raw) return DEFAULT_WIDTH;
    const n = Number(raw);
    return Number.isFinite(n) ? clampWidth(n) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(n: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(clampWidth(n)));
  } catch {
    /* ignore */
  }
}

/** Compact branch / isolation label for the task list. */
function sidebarBranchLabel(task: TaskSummary): string {
  if (task.isolation === "temporary_copy") return "一時コピー";
  if (task.isolation === "devcontainer") return "Dev Container";
  if (!task.branch) {
    return task.isolation === "current_folder" ? "HEAD" : "—";
  }
  if (task.isolation === "git_worktree" && task.branch.startsWith("webui/")) {
    return task.branch.slice("webui/".length);
  }
  return task.branch;
}

/**
 * Tiny brand icon for the provider of a task's current/last session model.
 * Mirrors the ProviderIcon in MessageMetaHeader: resolve a bundled brand icon
 * and fall back to a generic CPU glyph when there is no matching image.
 */
function ProviderIcon({ providerID }: { providerID?: string }) {
  const src = providerIconSrcForOpencodeId(providerID ?? "");
  const [broken, setBroken] = useState(false);

  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={12}
        height={12}
        data-testid="sidebar-provider-icon"
        className="h-3 w-3 shrink-0 rounded-[3px] object-contain"
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <Cpu
      aria-hidden="true"
      data-testid="provider-icon-fallback"
      className="h-3 w-3 shrink-0"
    />
  );
}

export function Sidebar({
  mobileOpen,
  onClose,
}: {
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const costPrefs = useCostDisplayPrefs();
  const { actionableItems: attentionItems } = useGlobalAttention();
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectsLoadError, setProjectsLoadError] = useState(false);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [archivedTasks, setArchivedTasks] = useState<TaskSummary[]>([]);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [engineOk, setEngineOk] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const mobileDrawerRef = useRef<HTMLElement | null>(null);
  const mobilePrevFocusRef = useRef<HTMLElement | null>(null);

  const activeTaskId = pathname.startsWith("/task/")
    ? pathname.slice("/task/".length).split("/")[0]
    : null;
  const [activeSessionAttention, setActiveSessionAttentionState] =
    useState<ActiveSessionAttention | null>(() => getActiveSessionAttention());

  useEffect(() => {
    const onAttention = (e: Event) => {
      const detail = (e as CustomEvent<ActiveSessionAttention | null>).detail;
      setActiveSessionAttentionState(detail ?? null);
    };
    window.addEventListener("webui:active-session-attention", onAttention);
    return () =>
      window.removeEventListener("webui:active-session-attention", onAttention);
  }, []);

  const attentionSessionIds = useMemo(() => {
    const ids = new Set(attentionItems.map((item) => item.request.sessionID));
    if (activeSessionAttention) {
      if (
        activeSessionAttention.permissions > 0 ||
        activeSessionAttention.questions > 0
      ) {
        ids.add(activeSessionAttention.sessionId);
      }
    }
    return ids;
  }, [attentionItems, activeSessionAttention]);

  const questionSessionIds = useMemo(() => {
    const ids = new Set(
      attentionItems
        .filter((item) => item.kind === "question")
        .map((item) => item.request.sessionID),
    );
    if (activeSessionAttention && activeSessionAttention.questions > 0) {
      ids.add(activeSessionAttention.sessionId);
    }
    return ids;
  }, [attentionItems, activeSessionAttention]);

  useEffect(() => {
    if (!mobileOpen) {
      if (mobilePrevFocusRef.current) {
        mobilePrevFocusRef.current.focus();
        mobilePrevFocusRef.current = null;
      }
      return;
    }
    mobilePrevFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = mobileDrawerRef.current;
    const first = panel?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !(el as HTMLButtonElement).disabled);
      if (focusables.length === 0) return;
      const firstEl = focusables[0]!;
      const lastEl = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen, onClose]);

  const refresh = useCallback(async () => {
    const [projectsResult, tasksResult, archivedResult] =
      await Promise.allSettled([
        getJson<{ projects: ProjectDto[] }>("/api/projects"),
        getJson<{ tasks: TaskSummary[]; engineOk: boolean }>("/api/tasks"),
        getJson<{ tasks: TaskSummary[] }>("/api/tasks/archived"),
      ]);
    if (projectsResult.status === "fulfilled") {
      setProjects(projectsResult.value.projects ?? []);
      setProjectsLoaded(true);
      setProjectsLoadError(false);
    } else {
      setProjectsLoadError(true);
    }
    if (tasksResult.status === "fulfilled") {
      setTasks(tasksResult.value.tasks ?? []);
      setEngineOk(tasksResult.value.engineOk);
    }
    if (archivedResult.status === "fulfilled") {
      setArchivedTasks(archivedResult.value.tasks ?? []);
    }
  }, []);

  useEffect(() => {
    setExpanded(loadExpanded());
    setWidth(loadWidth());
    setArchivedExpanded(() => {
      try {
        return localStorage.getItem(ARCHIVED_EXPANDED_KEY) === "true";
      } catch {
        return false;
      }
    });
    setHydrated(true);
    void refresh();
    const onVisible = () => {
      const visible = document.visibilityState === "visible";
      setPageVisible(visible);
      if (visible) void refresh();
    };
    const onChanged = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("webui:tasks-changed", onChanged);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("webui:tasks-changed", onChanged);
    };
  }, [refresh]);

  const hasActiveTask = tasks.some(
    (task) => task.status === "working",
  );
  useEffect(() => {
    if (!pageVisible || !hasActiveTask) return;
    const poll = setInterval(() => void refresh(), ACTIVE_TASK_POLL_MS);
    return () => clearInterval(poll);
  }, [hasActiveTask, pageVisible, refresh]);

  // Re-check engine health while the "engine not connected" banner is shown so
  // it self-clears once OpenCode becomes reachable (no manual reload needed).
  // Skipped while the tab is hidden to avoid background fetches; visibility
  // change already triggers refresh on focus.
  useEffect(() => {
    if (!pageVisible || engineOk) return;
    const poll = setInterval(() => void refresh(), ACTIVE_TASK_POLL_MS);
    return () => clearInterval(poll);
  }, [engineOk, pageVisible, refresh]);

  // Ensure the project owning the active task is expanded
  useEffect(() => {
    if (!activeTaskId || !hydrated) return;
    const task = tasks.find((t) => t.id === activeTaskId);
    if (!task) return;
    setExpanded((prev) => {
      if (prev.has(task.projectId)) return prev;
      const next = new Set(prev);
      next.add(task.projectId);
      saveExpanded(next);
      return next;
    });
  }, [activeTaskId, tasks, hydrated]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: PointerEvent) => {
      const next = clampWidth(e.clientX);
      setWidth(next);
    };
    const onUp = () => {
      setResizing(false);
      setWidth((w) => {
        saveWidth(w);
        return w;
      });
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [resizing]);

  const tasksByProject = useMemo(() => {
    const map = new Map<string, TaskSummary[]>();
    for (const t of tasks) {
      if (t.status === "orphaned") continue;
      const list = map.get(t.projectId) ?? [];
      list.push(t);
      map.set(t.projectId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    }
    return map;
  }, [tasks]);

  const archivedGroups = useMemo(() => {
    const byProject = new Map<string, TaskSummary[]>();
    for (const task of archivedTasks) {
      const group = byProject.get(task.projectId) ?? [];
      group.push(task);
      byProject.set(task.projectId, group);
    }
    const sortTasks = (group: TaskSummary[]) =>
      group.sort((a, b) => {
        if (a.updatedAt !== b.updatedAt) {
          return a.updatedAt < b.updatedAt ? 1 : -1;
        }
        return a.id.localeCompare(b.id);
      });
    const groups = projects.flatMap((project) => {
      const group = byProject.get(project.id);
      if (!group) return [];
      byProject.delete(project.id);
      return [{ key: `project:${project.id}`, name: project.name, tasks: sortTasks(group) }];
    });
    const unassigned = [...byProject.values()].flat();
    if (unassigned.length > 0) {
      groups.push({ key: "unassigned", name: "プロジェクトなし", tasks: sortTasks(unassigned) });
    }
    return groups;
  }, [archivedTasks, projects]);

  const orphanCount = tasks.filter((t) => t.status === "orphaned").length;

  const toggleProject = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveExpanded(next);
      return next;
    });
  };

  const archiveTask = async (task: TaskSummary, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await sendJson("PATCH", `/api/tasks/${task.id}/archive`);
      if (activeTaskId === task.id) router.push("/");
      notifyTasksChanged();
      await refresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "タスクのアーカイブに失敗しました";
      window.alert(msg);
      notifyTasksChanged();
      await refresh();
    }
  };

  const toggleArchived = () => {
    setArchivedExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ARCHIVED_EXPANDED_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const restoreArchivedTask = async (
    task: TaskSummary,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await sendJson("PATCH", `/api/tasks/${task.id}/restore`);
      notifyTasksChanged();
      await refresh();
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "タスクの復元に失敗しました",
      );
    }
  };

  const destroyArchivedTask = async (
    task: TaskSummary,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const label =
      task.isolation === "current_folder"
        ? `「${task.title}」を完全に削除しますか？（フォルダはそのまま残ります）`
        : `「${task.title}」を完全に削除しますか？ worktree/コピーも削除されます。`;
    if (!window.confirm(label)) return;
    try {
      await sendJson("DELETE", `/api/tasks/${task.id}`);
      notifyTasksChanged();
      await refresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "タスクの削除に失敗しました";
      window.alert(
        msg.includes("orphaned") || msg.includes("worktree")
          ? `${msg}\n\n設定 → 「orphan を掃除」で残件を削除できます。`
          : msg,
      );
      notifyTasksChanged();
      await refresh();
    }
  };

  const toggleFavorite = async (p: ProjectDto, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await sendJson("PATCH", "/api/projects", {
        id: p.id,
        favorite: !p.favorite,
      });
      notifyTasksChanged();
      await refresh();
    } catch {
      /* ignore */
    }
  };

  const removeProject = async (p: ProjectDto, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (
      !window.confirm(
        `プロジェクト「${p.name}」を削除しますか？\n関連タスク / worktree も削除されます。`,
      )
    ) {
      return;
    }
    try {
      await sendJson("DELETE", "/api/projects", undefined, { id: p.id });
      notifyTasksChanged();
      await refresh();
      if (activeTaskId) {
        const still = tasks.find((t) => t.id === activeTaskId);
        if (!still || still.projectId === p.id) router.push("/");
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "削除に失敗しました");
    }
  };

  const nav = (href: string) => {
    onClose();
    router.push(href);
  };

  const refreshTitle = useCallback(
    async (task: TaskSummary, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!task.sessionId || refreshingId === task.id) return;
      setRefreshingId(task.id);
      setRefreshError(null);
      try {
        const { title } = await sendJson<{ title: string }>(
          "POST",
          `/api/workspaces/${task.id}/sessions/${task.sessionId}/refresh-title`,
        );
        setTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, title } : t)),
        );
        notifyTasksChanged();
      } catch (err) {
        setRefreshError(
          err instanceof Error ? err.message : "タイトルの更新に失敗しました",
        );
      } finally {
        setRefreshingId(null);
      }
    },
    [refreshingId],
  );

  const body = (includeAddons: boolean) => (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2">
        <Link
          href="/"
          onClick={() => onClose()}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold tracking-tight hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon-192.png"
            alt=""
            width={18}
            height={18}
            className="h-4.5 w-4.5 shrink-0 rounded-[3px] object-contain"
          />
          <span className="truncate">OpenCodeWebUI</span>
        </Link>
        <Link
          href="/"
          onClick={() => onClose()}
          title="新規タスク"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          <Plus className="h-4 w-4" />
        </Link>
        <AddProjectButton
          variant="icon"
          onAdded={() => {
            void refresh();
            onClose();
          }}
        />
        <Link
          href="/settings"
          onClick={() => onClose()}
          title="設定"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          <Settings className="h-4 w-4" />
        </Link>
        <AttentionBadge />
        <ThemeToggle />
      </div>

      {!engineOk && (
        <div className="shrink-0 border-b border-warning/30 bg-warning-bg px-3 py-2 text-[11px] leading-snug text-warning">
          エンジン未接続。設定またはトレイから OpenCode を再起動してください。
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-2">
        {!projectsLoaded ? (
          <div className="flex min-h-24 items-center justify-center px-2 py-4">
            <div
              role="status"
              aria-label={
                projectsLoadError
                  ? "プロジェクトを読み込めませんでした"
                  : "プロジェクトを読み込み中"
              }
              className="text-center text-xs text-muted"
            >
              {projectsLoadError
                ? "プロジェクトを読み込めませんでした"
                : "プロジェクトを読み込み中"}
            </div>
          </div>
        ) : projects.length === 0 ? (
          <div className="px-2 py-4">
            <p className="mb-3 text-center text-xs text-muted">
              プロジェクトがありません
            </p>
            <AddProjectButton
              onAdded={() => {
                void refresh();
                onClose();
              }}
            />
          </div>
        ) : (
          <ul className="space-y-0.5">
            {projects.map((p) => {
              const open = expanded.has(p.id);
              const children = tasksByProject.get(p.id) ?? [];
              return (
                <li key={p.id}>
                  <div className="flex min-w-0 items-center gap-0.5">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={`${p.name}を${open ? "折りたたむ" : "展開"}`}
                      onClick={() => toggleProject(p.id)}
                      className="flex min-w-0 min-h-11 flex-1 cursor-pointer items-center gap-1 rounded-lg px-1.5 py-1.5 text-left text-xs font-medium text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary md:min-h-8"
                    >
                      <ChevronRight
                        className={cx(
                          "h-3.5 w-3.5 shrink-0 transition-transform",
                          open && "rotate-90",
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="tabular-nums text-[10px] text-muted">
                        {children.length}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        aria-label={`${p.name}を${p.favorite ? "お気に入りから外す" : "お気に入りに追加"}`}
                        title={p.favorite ? "お気に入りから外す" : "お気に入りに追加"}
                        onClick={(e) => void toggleFavorite(p, e)}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary md:h-8 md:w-8"
                      >
                        <Star
                          className={
                            p.favorite
                              ? "h-3 w-3 fill-warning text-warning"
                              : "h-3 w-3"
                          }
                          aria-hidden="true"
                        />
                      </button>
                      <button
                        type="button"
                        aria-label={`${p.name}に新規タスクを作成`}
                        title="新規タスク"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          nav(`/?projectId=${encodeURIComponent(p.id)}`);
                        }}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary md:h-8 md:w-8"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`${p.name}を削除`}
                        title="プロジェクトを削除"
                        onClick={(e) => void removeProject(p, e)}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-danger-bg hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary md:h-8 md:w-8"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {open && (
                    <ul className="mb-1 ml-2 space-y-0.5 border-l border-border pl-1.5">
                      {children.length === 0 ? (
                        <li className="px-2 py-1.5 text-[11px] text-muted">
                          タスクなし
                        </li>
                      ) : (
                        children.map((task) => {
                          const active = task.id === activeTaskId;
                          const waitingForAttention =
                            task.sessionId !== null &&
                            attentionSessionIds.has(task.sessionId);
                          const waitingForQuestion =
                            task.sessionId !== null &&
                            questionSessionIds.has(task.sessionId);
                          return (
                            <li key={task.id}>
                              <div
                                className={cx(
                                  "flex items-start gap-0.5 rounded-lg",
                                  active
                                    ? "bg-surface-3 text-text"
                                    : "text-muted hover:bg-surface-2 hover:text-text",
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => nav(`/task/${task.id}`)}
                                  className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <span className="flex h-3 w-3 shrink-0 items-center justify-center">
                                      {!waitingForAttention &&
                                      task.status === "working" ? (
                                        <Loader2
                                          aria-label="エージェントが処理中"
                                          className="h-3 w-3 animate-spin text-working"
                                        />
                                      ) : (
                                        <span
                                          aria-label={
                                            waitingForQuestion
                                              ? "質問への回答待ち"
                                              : waitingForAttention
                                                ? "権限の承認待ち"
                                                : `状態: ${task.status}`
                                          }
                                          className={cx(
                                            "h-1.5 w-1.5 rounded-full",
                                            task.status === "working" &&
                                              "animate-pulse",
                                            waitingForAttention && "bg-warning",
                                            !waitingForAttention &&
                                              task.status === "ready" &&
                                              "bg-success",
                                            !waitingForAttention &&
                                              task.status === "merged" &&
                                              "bg-success",
                                            !waitingForAttention &&
                                              task.status === "error" &&
                                              "bg-danger",
                                            !waitingForAttention &&
                                              (task.status === "idle" ||
                                                task.status === "unknown") &&
                                              "bg-faint",
                                          )}
                                        />
                                      )}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                      {task.title}
                                    </span>
                                    <span className="shrink-0 text-[10px] text-muted">
                                      {timeAgo(task.updatedAt)}
                                    </span>
                                  </div>
                                  <div
                                    className="flex min-w-0 items-center gap-1 pl-3 text-[10px] text-muted"
                                    title={
                                      task.branch
                                        ? `${task.isolation}: ${task.branch}`
                                        : task.isolation
                                    }
                                  >
                                    <GitBranch className="h-2.5 w-2.5 shrink-0 opacity-70" />
                                    <span className="min-w-0 truncate font-mono">
                                      {sidebarBranchLabel(task)}
                                    </span>
                                    {task.providerID && (
                                      <span
                                        className="ml-auto flex shrink-0 items-center"
                                        title={
                                          task.agent
                                            ? `エージェント: ${task.agent}`
                                            : `プロバイダ: ${task.providerID}`
                                        }
                                      >
                                        <ProviderIcon
                                          key={task.providerID}
                                          providerID={task.providerID}
                                        />
                                      </span>
                                    )}
                                    {(task.cost ?? 0) > 0 ? (
                                      <span
                                        className={cx(
                                          "min-w-[2.75rem] shrink-0 text-right tabular-nums whitespace-nowrap text-faint",
                                          !task.providerID && "ml-auto",
                                        )}
                                        title="このセッションの累計コスト"
                                      >
                                        {formatCostValue(task.cost!, costPrefs)}
                                      </span>
                                    ) : (
                                      // Reserve the cost column so the provider icon
                                      // stays in the same place on every row.
                                      <span
                                        aria-hidden
                                        className="min-w-[2.75rem] shrink-0"
                                      />
                                    )}
                                  </div>
                                </button>
                                <div className="flex shrink-0 items-center pt-0.5 pr-0.5">
                                  {task.sessionId && (
                                    <button
                                      type="button"
                                      aria-label="会話からタイトルを再生成"
                                      title="会話からタイトルを再生成"
                                      aria-busy={refreshingId === task.id}
                                      disabled={refreshingId === task.id}
                                      onClick={(e) => void refreshTitle(task, e)}
                                      className="inline-flex h-11 w-11 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-50 md:h-8 md:w-8"
                                    >
                                      <RefreshCw
                                        className={cx(
                                          "h-3 w-3",
                                          refreshingId === task.id &&
                                            "motion-safe:animate-spin",
                                        )}
                                      />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    aria-label="タスクをアーカイブ"
                                    title="タスクをアーカイブ"
                                    onClick={(e) => void archiveTask(task, e)}
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary md:h-8 md:w-8"
                                  >
                                    <Archive className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-2">
          <button
            type="button"
            aria-expanded={archivedExpanded}
            aria-label={`アーカイブ${archivedExpanded ? "を折りたたむ" : "を展開"}`}
            onClick={toggleArchived}
            className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          >
            <Archive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">アーカイブ</span>
            <span className="tabular-nums text-[10px] text-muted">
              {archivedTasks.length}
            </span>
            <ChevronRight
              className={cx(
                "h-3 w-3 shrink-0 transition-transform",
                archivedExpanded && "rotate-90",
              )}
              aria-hidden="true"
            />
          </button>
          {archivedExpanded && (
            <ul className="mb-1 ml-2 space-y-0.5 border-l border-border pl-1.5">
              {archivedTasks.length === 0 ? (
                <li className="px-2 py-1.5 text-[11px] text-muted">
                  アーカイブされたタスクはありません
                </li>
              ) : (
                archivedGroups.map((group) => (
                  <li key={group.key} data-testid="archived-project-group">
                    <div className="flex items-center justify-between px-2 py-1 text-[11px] font-medium text-muted">
                      <span className="truncate">{group.name}</span>
                      <span className="tabular-nums text-[10px] text-muted">
                        {group.tasks.length}
                      </span>
                    </div>
                    <ul className="space-y-0.5">
                      {group.tasks.map((task) => (
                        <li key={task.id}>
                          <div className="flex items-start gap-0.5 rounded-lg text-muted hover:bg-surface-2 hover:text-text">
                      <button
                        type="button"
                        onClick={() => nav(`/task/${task.id}`)}
                        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="flex h-3 w-3 shrink-0 items-center justify-center">
                            <span
                              aria-label={`状態: ${task.status}`}
                              className="h-1.5 w-1.5 rounded-full bg-success"
                            />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">
                            {task.title}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted">
                            {timeAgo(task.updatedAt)}
                          </span>
                        </div>
                        <div className="flex min-w-0 items-center gap-1 pl-3 text-[10px] text-muted">
                          <GitBranch className="h-2.5 w-2.5 shrink-0 opacity-70" />
                          <span className="min-w-0 truncate font-mono">
                            {sidebarBranchLabel(task)}
                          </span>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center pt-0.5 pr-0.5">
                        <button
                          type="button"
                          aria-label="タスクを復元"
                          title="タスクを復元"
                          onClick={(e) => void restoreArchivedTask(task, e)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary md:h-8 md:w-8"
                        >
                          <ArchiveRestore className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="タスクを完全に削除"
                          title="タスクを完全に削除"
                          onClick={(e) => void destroyArchivedTask(task, e)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-danger-bg hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary md:h-8 md:w-8"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        {orphanCount > 0 && (
          <Link
            href="/settings"
            onClick={() => onClose()}
            className="mt-3 block rounded-lg px-2 py-2 text-center text-[11px] text-warning hover:bg-warning-bg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          >
            要復旧 {orphanCount} 件 → 設定
          </Link>
        )}

        {refreshError && (
          <div
            role="status"
            className="mt-2 rounded-lg bg-danger-bg px-2 py-1.5 text-[11px] text-danger"
          >
            {refreshError}
          </div>
        )}

        {projects.length > 0 && (
          <div className="mt-3 border-t border-border px-1 pt-3">
            <AddProjectButton
              onAdded={() => {
                void refresh();
              }}
            />
          </div>
        )}

      </div>
      {includeAddons && (
        <div className="shrink-0 border-t border-border px-1.5 pb-[env(safe-area-inset-bottom)]">
          <AddonHost />
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside
        className="relative hidden h-full shrink-0 border-r border-border md:block"
        style={{ width }}
      >
        {body(!mobileOpen)}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="サイドバー幅を調整"
          aria-valuenow={width}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          title="ドラッグで幅を変更（ダブルクリックでリセット）"
          onPointerDown={(e) => {
            e.preventDefault();
            setResizing(true);
          }}
          onDoubleClick={() => {
            setWidth(DEFAULT_WIDTH);
            saveWidth(DEFAULT_WIDTH);
          }}
          className={cx(
            "absolute top-0 right-0 z-10 h-full w-1.5 translate-x-1/2 cursor-col-resize touch-none",
            "hover:bg-accent/40 active:bg-accent/60",
            resizing && "bg-accent/50",
          )}
        />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="サイドバーを閉じる"
            className="absolute inset-0 bg-black/40"
            onClick={onClose}
          />
          <aside
            ref={mobileDrawerRef}
            id="mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="ナビゲーション"
            className="absolute top-0 left-0 h-dvh w-[min(18rem,85vw)] overflow-hidden pb-[env(safe-area-inset-bottom)] shadow-xl pt-[env(safe-area-inset-top)]"
          >
            {body(mobileOpen)}
          </aside>
        </div>
      )}
    </>
  );
}
