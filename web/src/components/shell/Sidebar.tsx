"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronRight,
  FolderGit2,
  GitBranch,
  Plus,
  RefreshCw,
  Settings,
  Star,
  Trash2,
} from "lucide-react";
import { AddProjectButton } from "@/components/AddProjectButton";
import { PluginHost } from "@/components/plugins/PluginHost";
import { ThemeToggle, cx, timeAgo } from "@/components/ui";
import { notifyTasksChanged } from "@/lib/events";
import { getJson, sendJson } from "@/lib/client";
import { AttentionBadge } from "./AttentionBadge";
import type { ProjectDto, TaskSummary } from "@/lib/types";

const EXPANDED_KEY = "webui.sidebar.expanded";
const WIDTH_KEY = "webui.sidebar.width";
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 180;
const MAX_WIDTH = 480;

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

export function Sidebar({
  mobileOpen,
  onClose,
}: {
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectsLoadError, setProjectsLoadError] = useState(false);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [engineOk, setEngineOk] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const activeTaskId = pathname.startsWith("/task/")
    ? pathname.slice("/task/".length).split("/")[0]
    : null;

  const refresh = useCallback(async () => {
    const [projectsResult, tasksResult] = await Promise.allSettled([
      getJson<{ projects: ProjectDto[] }>("/api/projects"),
      getJson<{ tasks: TaskSummary[]; engineOk: boolean }>("/api/tasks"),
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
  }, []);

  useEffect(() => {
    setExpanded(loadExpanded());
    setWidth(loadWidth());
    setHydrated(true);
    void refresh();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 8000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onChanged = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("webui:tasks-changed", onChanged);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("webui:tasks-changed", onChanged);
    };
  }, [refresh]);

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

  const removeTask = async (task: TaskSummary, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const label =
      task.isolation === "current_folder"
        ? `「${task.title}」を一覧から削除しますか？（フォルダはそのまま残ります）`
        : `「${task.title}」を削除しますか？ worktree/コピーも削除されます。`;
    if (!window.confirm(label)) return;
    try {
      await sendJson("DELETE", `/api/tasks/${task.id}`);
      if (activeTaskId === task.id) router.push("/");
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

  const body = (includePlugins: boolean) => (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2">
        <Link
          href="/"
          onClick={() => onClose()}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold tracking-tight hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          <FolderGit2 className="h-4.5 w-4.5 shrink-0" />
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
                                    <span
                                      className={cx(
                                        "h-1.5 w-1.5 shrink-0 rounded-full",
                                        task.status === "working" &&
                                          "animate-pulse bg-working",
                                        task.status === "ready" && "bg-success",
                                        task.status === "merged" && "bg-success",
                                        task.status === "error" && "bg-danger",
                                        (task.status === "idle" ||
                                          task.status === "unknown") &&
                                          "bg-faint",
                                      )}
                                    />
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
                                    aria-label="タスクを削除"
                                    title="タスクを削除"
                                    onClick={(e) => void removeTask(task, e)}
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-danger-bg hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary md:h-8 md:w-8"
                                  >
                                    <Trash2 className="h-3 w-3" />
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
      {includePlugins && (
        <div className="shrink-0 border-t border-border px-1.5 pb-[env(safe-area-inset-bottom)]">
          <PluginHost />
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
          <aside className="absolute inset-y-0 left-0 w-[min(18rem,85vw)] pb-[env(safe-area-inset-bottom)] shadow-xl pt-[env(safe-area-inset-top)]">
            {body(mobileOpen)}
          </aside>
        </div>
      )}
    </>
  );
}
