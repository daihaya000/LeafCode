"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  FolderGit2,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";
import { Badge, Button, DiffStat, Spinner, ThemeToggle, cx, timeAgo } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client";
import type { ProjectDto, TaskStatus, TaskSummary } from "@/lib/types";

const ISOLATIONS = [
  { value: "git_worktree", label: "Worktree（分離）" },
  { value: "current_folder", label: "そのまま" },
  { value: "temporary_copy", label: "一時コピー" },
  { value: "devcontainer", label: "Dev Container" },
] as const;

const STATUS_META: Record<
  TaskStatus,
  { label: string; tone: "neutral" | "working" | "success" | "warning" | "danger"; pulse?: boolean }
> = {
  working: { label: "実行中", tone: "working", pulse: true },
  ready: { label: "変更あり", tone: "success" },
  idle: { label: "クリーン", tone: "neutral" },
  error: { label: "エラー", tone: "danger" },
  orphaned: { label: "要復旧", tone: "warning" },
  unknown: { label: "不明", tone: "neutral" },
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.unknown;
  return (
    <Badge tone={meta.tone} pulse={meta.pulse}>
      {meta.label}
    </Badge>
  );
}

export function isolationLabel(value: string): string {
  return ISOLATIONS.find((i) => i.value === value)?.label ?? value;
}

export function HomeView() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [engineOk, setEngineOk] = useState(true);
  const [projectId, setProjectId] = useState("");
  const [isolation, setIsolation] = useState<string>("git_worktree");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newProjectPath, setNewProjectPath] = useState("");
  const [addingProject, setAddingProject] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);

  const refreshProjects = useCallback(async () => {
    try {
      const data = await getJson<{ projects: ProjectDto[] }>("/api/projects");
      setProjects(data.projects ?? []);
      setProjectId((cur) => cur || data.projects?.[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "projects failed");
    }
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      const data = await getJson<{ tasks: TaskSummary[]; engineOk: boolean }>(
        "/api/tasks",
      );
      setTasks(data.tasks ?? []);
      setEngineOk(data.engineOk);
    } catch {
      /* keep previous list */
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
    void refreshTasks();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refreshTasks();
    }, 8000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshTasks();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshProjects, refreshTasks]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, []);

  const submit = useCallback(async () => {
    const text = prompt.trim();
    if (!text || !projectId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await sendJson<{ taskId: string }>("POST", "/api/tasks", {
        projectId,
        prompt: text,
        isolation,
      });
      router.push(`/task/${data.taskId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "タスク作成に失敗しました");
      setSubmitting(false);
    }
  }, [prompt, projectId, isolation, submitting, router]);

  const addProject = useCallback(async () => {
    const p = newProjectPath.trim();
    if (!p) return;
    setAddingProject(true);
    setError(null);
    try {
      const data = await sendJson<{ project: ProjectDto }>("POST", "/api/projects", {
        rootPath: p,
      });
      setNewProjectPath("");
      await refreshProjects();
      setProjectId(data.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "プロジェクト追加に失敗しました");
    } finally {
      setAddingProject(false);
    }
  }, [newProjectPath, refreshProjects]);

  const removeTask = useCallback(
    async (task: TaskSummary) => {
      const label =
        task.isolation === "current_folder"
          ? `「${task.title}」を一覧から削除しますか？（フォルダはそのまま残ります）`
          : `「${task.title}」を削除しますか？ worktree/コピーも削除されます。`;
      if (!window.confirm(label)) return;
      try {
        await sendJson("DELETE", `/api/tasks/${task.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "削除に失敗しました");
      }
      await refreshTasks();
    },
    [refreshTasks],
  );

  const activeTasks = useMemo(
    () => (tasks ?? []).filter((t) => t.status !== "orphaned"),
    [tasks],
  );
  const orphanCount = (tasks ?? []).length - activeTasks.length;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <FolderGit2 className="h-5 w-5" />
            OpenCode WebUI
          </div>
          <div className="flex items-center gap-1">
            <Link
              href="/settings"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
              aria-label="設定"
            >
              <Settings className="h-4.5 w-4.5" />
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {!engineOk && tasks !== null && (
        <div className="border-b border-warning/30 bg-warning-bg px-4 py-2.5 text-center text-sm text-warning">
          OpenCode エンジンに接続できません。トレイから再起動してください。
        </div>
      )}

      <main className="mx-auto max-w-4xl px-4 pb-24">
        {/* Composer hero */}
        <section className="pt-14 pb-10 sm:pt-20">
          <h1 className="mb-6 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
            何をつくりますか？
          </h1>
          <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-surface shadow-sm focus-within:border-border-strong">
            <textarea
              ref={textareaRef}
              value={prompt}
              rows={2}
              onChange={(e) => {
                setPrompt(e.target.value);
                autoResize();
              }}
              onCompositionStart={() => (composingRef.current = true)}
              onCompositionEnd={() => (composingRef.current = false)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  (e.metaKey || e.ctrlKey) &&
                  !composingRef.current
                ) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="タスクを説明してください…（Ctrl+Enter で開始）"
              className="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-base outline-none placeholder:text-faint"
            />
            <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="h-9 max-w-44 cursor-pointer rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium text-muted outline-none hover:text-text"
              >
                {projects.length === 0 && <option value="">プロジェクトなし</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.favorite ? "★ " : ""}
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={isolation}
                onChange={(e) => setIsolation(e.target.value)}
                className="h-9 cursor-pointer rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium text-muted outline-none hover:text-text"
              >
                {ISOLATIONS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
              <div className="flex-1" />
              <Button
                variant="primary"
                size="icon"
                aria-label="タスク開始"
                busy={submitting}
                disabled={!prompt.trim() || !projectId || !engineOk}
                onClick={() => void submit()}
              >
                {!submitting && <ArrowUp className="h-4.5 w-4.5" />}
              </Button>
            </div>
          </div>

          {projects.length === 0 && tasks !== null && (
            <div className="mx-auto mt-4 flex max-w-2xl gap-2">
              <input
                value={newProjectPath}
                onChange={(e) => setNewProjectPath(e.target.value)}
                placeholder="C:\path\to\repo — まずプロジェクトを追加"
                className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-border-strong"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addProject();
                }}
              />
              <Button busy={addingProject} onClick={() => void addProject()}>
                <Plus className="h-4 w-4" />
                追加
              </Button>
            </div>
          )}

          {error && (
            <p className="mx-auto mt-3 max-w-2xl rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
        </section>

        {/* Task list */}
        <section className="mx-auto max-w-3xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted">タスク</h2>
            <div className="flex items-center gap-2">
              {orphanCount > 0 && (
                <Link href="/settings" className="text-xs text-warning underline">
                  要復旧 {orphanCount} 件
                </Link>
              )}
              <Button variant="ghost" size="sm" onClick={() => void refreshTasks()}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {tasks === null ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : activeTasks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-faint">
              タスクはまだありません。上の入力欄から始めましょう。
            </p>
          ) : (
            <ul className="space-y-2">
              {activeTasks.map((task) => (
                <li key={task.id} className="group relative">
                  <Link
                    href={`/task/${task.id}`}
                    className="block rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
                  >
                    <div className="flex items-center gap-3">
                      <StatusBadge status={task.status} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {task.title}
                      </span>
                      <DiffStat
                        additions={task.additions}
                        deletions={task.deletions}
                        className="hidden sm:inline-flex"
                      />
                      <span className="shrink-0 text-xs text-faint">
                        {timeAgo(task.updatedAt)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 pl-0.5 text-xs text-faint">
                      <span className="truncate">{task.projectName}</span>
                      <span>·</span>
                      <span>{isolationLabel(task.isolation)}</span>
                      {task.branch && (
                        <>
                          <span>·</span>
                          <span className="truncate font-mono">{task.branch}</span>
                        </>
                      )}
                    </div>
                  </Link>
                  <button
                    type="button"
                    aria-label="タスクを削除"
                    onClick={() => void removeTask(task)}
                    className={cx(
                      "absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-lg p-2 text-faint",
                      "hover:bg-danger-bg hover:text-danger group-hover:block",
                    )}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
