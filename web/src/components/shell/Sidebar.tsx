"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronRight,
  FolderGit2,
  Plus,
  Settings,
  Star,
  Trash2,
} from "lucide-react";
import { AddProjectButton } from "@/components/AddProjectButton";
import { ThemeToggle, cx, timeAgo } from "@/components/ui";
import { notifyTasksChanged } from "@/lib/events";
import { getJson, sendJson } from "@/lib/client";
import type { ProjectDto, TaskSummary } from "@/lib/types";

const EXPANDED_KEY = "webui.sidebar.expanded";

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
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [engineOk, setEngineOk] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  const activeTaskId = pathname.startsWith("/task/")
    ? pathname.slice("/task/".length).split("/")[0]
    : null;

  const refresh = useCallback(async () => {
    try {
      const [p, t] = await Promise.all([
        getJson<{ projects: ProjectDto[] }>("/api/projects"),
        getJson<{ tasks: TaskSummary[]; engineOk: boolean }>("/api/tasks"),
      ]);
      setProjects(p.projects ?? []);
      setTasks(t.tasks ?? []);
      setEngineOk(t.engineOk);
    } catch {
      /* keep previous */
    }
  }, []);

  useEffect(() => {
    setExpanded(loadExpanded());
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

  const body = (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2">
        <Link
          href="/"
          onClick={() => onClose()}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold tracking-tight hover:bg-surface-2"
        >
          <FolderGit2 className="h-4.5 w-4.5 shrink-0" />
          <span className="truncate">OpenCode</span>
        </Link>
        <Link
          href="/"
          onClick={() => onClose()}
          title="新規タスク"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
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
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
        >
          <Settings className="h-4 w-4" />
        </Link>
        <ThemeToggle />
      </div>

      {!engineOk && (
        <div className="shrink-0 border-b border-warning/30 bg-warning-bg px-3 py-2 text-[11px] leading-snug text-warning">
          エンジン未接続。トレイから再起動してください。
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-2">
        {projects.length === 0 ? (
          <div className="px-2 py-4">
            <p className="mb-3 text-center text-xs text-faint">
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
                <li key={p.id} className="group/project">
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => toggleProject(p.id)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-lg px-1.5 py-1.5 text-left text-xs font-medium text-muted hover:bg-surface-2 hover:text-text"
                    >
                      <ChevronRight
                        className={cx(
                          "h-3.5 w-3.5 shrink-0 transition-transform",
                          open && "rotate-90",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="tabular-nums text-[10px] text-faint">
                        {children.length}
                      </span>
                    </button>
                    <button
                      type="button"
                      title="お気に入り"
                      onClick={(e) => void toggleFavorite(p, e)}
                      className="hidden shrink-0 rounded-md p-1 text-faint hover:bg-surface-2 group-hover/project:inline-flex"
                    >
                      <Star
                        className={
                          p.favorite
                            ? "h-3 w-3 fill-warning text-warning"
                            : "h-3 w-3"
                        }
                      />
                    </button>
                    <button
                      type="button"
                      title="プロジェクトを削除"
                      onClick={(e) => void removeProject(p, e)}
                      className="hidden shrink-0 rounded-md p-1 text-faint hover:bg-danger-bg hover:text-danger group-hover/project:inline-flex"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  {open && (
                    <ul className="mb-1 ml-2 space-y-0.5 border-l border-border pl-1.5">
                      {children.length === 0 ? (
                        <li className="px-2 py-1.5 text-[11px] text-faint">
                          タスクなし
                        </li>
                      ) : (
                        children.map((task) => {
                          const active = task.id === activeTaskId;
                          return (
                            <li key={task.id} className="group relative">
                              <button
                                type="button"
                                onClick={() => nav(`/task/${task.id}`)}
                                className={cx(
                                  "flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left",
                                  active
                                    ? "bg-surface-3 text-text"
                                    : "text-muted hover:bg-surface-2 hover:text-text",
                                )}
                              >
                                <div className="flex items-center gap-1.5 pr-5">
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
                                  <span className="shrink-0 text-[10px] text-faint">
                                    {timeAgo(task.updatedAt)}
                                  </span>
                                </div>
                              </button>
                              <button
                                type="button"
                                aria-label="タスクを削除"
                                onClick={(e) => void removeTask(task, e)}
                                className="absolute top-1.5 right-1 hidden rounded-md p-1 text-faint hover:bg-danger-bg hover:text-danger group-hover:block"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
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
            className="mt-3 block rounded-lg px-2 py-2 text-center text-[11px] text-warning hover:bg-warning-bg"
          >
            要復旧 {orphanCount} 件 → 設定
          </Link>
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
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden h-full w-60 shrink-0 border-r border-border md:block">
        {body}
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
          <aside className="absolute inset-y-0 left-0 w-[min(18rem,85vw)] shadow-xl">
            {body}
          </aside>
        </div>
      )}
    </>
  );
}
