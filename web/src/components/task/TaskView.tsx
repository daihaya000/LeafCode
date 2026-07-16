"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  GitBranch,
  ListTodo,
  Loader2,
  PanelRight,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import { CommandPalette } from "@/components/CommandPalette";
import { StatusBadge } from "@/components/home/HomeView";
import { Button, Spinner, ThemeToggle, cx } from "@/components/ui";
import { getJson, ocJson, sendJson } from "@/lib/client";
import { useSessionStream } from "@/lib/useSessionStream";
import type { TaskSummary, Todo } from "@/lib/types";
import { DiffPane } from "./DiffPane";
import { PartView } from "./PartView";
import { PermissionCard } from "./PermissionCard";

function TodoPanel({ todos }: { todos: Todo[] }) {
  const [open, setOpen] = useState(false);
  const done = todos.filter((t) => t.status === "completed").length;
  if (todos.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-xs text-muted"
      >
        <ListTodo className="h-3.5 w-3.5" />
        プラン {done}/{todos.length}
        <ChevronRight
          className={cx("h-3 w-3 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <ul className="space-y-1 border-t border-border px-3 py-2">
          {todos.map((t, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              {t.status === "completed" ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              ) : t.status === "in_progress" ? (
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-working" />
              ) : (
                <span className="mt-1 ml-0.5 h-2 w-2 shrink-0 rounded-full border border-faint" />
              )}
              <span
                className={cx(
                  t.status === "completed" ? "text-faint line-through" : "text-muted",
                )}
              >
                {t.content}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TaskView({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [task, setTask] = useState<TaskSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "diff">("chat");
  const [showDiff, setShowDiff] = useState(true);
  const [diffKey, setDiffKey] = useState(0);
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const composingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const stream = useSessionStream(
    task?.directory ?? null,
    task?.sessionId ?? null,
  );

  const refreshTask = useCallback(async () => {
    try {
      const data = await getJson<{ task: TaskSummary }>(`/api/tasks/${taskId}`);
      setTask(data.task);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "タスクを読み込めません");
    }
  }, [taskId]);

  useEffect(() => {
    void refreshTask();
  }, [refreshTask]);

  // busy → idle transition: refresh diff + task stats
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const cur = stream.status?.type ?? null;
    if (prevStatusRef.current === "busy" && cur === "idle") {
      setDiffKey((k) => k + 1);
      void refreshTask();
    }
    prevStatusRef.current = cur;
  }, [stream.status, refreshTask]);

  // Auto-stick scroll to bottom
  useEffect(() => {
    if (stickRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [stream.messages, stream.permissions, stream.status]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
  }, []);

  const working = stream.status !== null && stream.status.type !== "idle";

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setSendError(null);
    stickRef.current = true;
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    try {
      await stream.sendPrompt(text);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "送信に失敗しました");
      setInput(text);
    }
  }, [input, stream]);

  const copyPath = useCallback(async () => {
    if (!task) return;
    await navigator.clipboard.writeText(task.directory).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [task]);

  const removeTask = useCallback(async () => {
    if (!task) return;
    const label =
      task.isolation === "current_folder"
        ? "このタスクを一覧から削除しますか？（フォルダは残ります）"
        : "このタスクを削除しますか？ worktree/コピーも削除されます。";
    if (!window.confirm(label)) return;
    try {
      await sendJson("DELETE", `/api/tasks/${task.id}`);
      router.push("/");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "削除に失敗しました");
    }
  }, [task, router]);

  const ensureSession = useCallback(async () => {
    if (!task) return;
    try {
      const session = await ocJson<{ id: string }>("/session", task.directory, {
        method: "POST",
        body: { title: task.title },
      });
      await sendJson("POST", `/api/workspaces/${task.id}/sessions`, {
        opencodeSessionId: session.id,
        title: task.title,
      });
      await refreshTask();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "セッション作成に失敗しました");
    }
  }, [task, refreshTask]);

  const openFileInDiff = useCallback((path: string) => {
    setFocusFile(path);
    setShowDiff(true);
    setTab("diff");
  }, []);

  const timeline = useMemo(
    () =>
      stream.messages.filter((m) =>
        m.parts.some(
          (p) =>
            (p.type === "text" && p.text?.trim()) ||
            p.type === "tool" ||
            p.type === "reasoning" ||
            p.type === "file" ||
            p.type === "patch" ||
            p.type === "agent",
        ),
      ),
    [stream.messages],
  );

  if (loadError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
        <p className="text-sm text-danger">{loadError}</p>
        <Link href="/" className="text-sm text-accent underline">
          ホームへ戻る
        </Link>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const chatVisible = tab === "chat";
  const diffVisible = tab === "diff";

  return (
    <div className="flex h-dvh flex-col">
      <CommandPalette directory={task.directory} onFile={openFileInDiff} />
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <Link
          href="/"
          aria-label="ホームへ戻る"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold">{task.title}</h1>
            <StatusBadge status={working ? "working" : task.status} />
            {stream.connection === "reconnecting" && (
              <span className="hidden text-xs text-warning sm:inline">再接続中…</span>
            )}
          </div>
          {task.branch && (
            <div className="mt-0.5 hidden items-center gap-1 text-xs text-faint sm:flex">
              <GitBranch className="h-3 w-3" />
              <span className="truncate font-mono">{task.branch}</span>
              <span className="mx-1">·</span>
              <span className="truncate">{task.projectName}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {working && (
            <Button variant="danger" size="sm" onClick={() => void stream.abort()}>
              <Square className="h-3 w-3 fill-current" />
              停止
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            title={copied ? "コピーしました" : "作業パスをコピー"}
            onClick={() => void copyPath()}
          >
            {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="再同期"
            onClick={() => {
              void stream.resync();
              setDiffKey((k) => k + 1);
            }}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="タスクを削除"
            onClick={() => void removeTask()}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Diff パネル"
            className={cx("hidden lg:inline-flex", showDiff && "bg-surface-2 text-text")}
            onClick={() => setShowDiff((v) => !v)}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Mobile tabs */}
      <div className="flex shrink-0 border-b border-border bg-surface lg:hidden">
        {(
          [
            { key: "chat", label: "会話" },
            {
              key: "diff",
              label:
                task.filesChanged > 0 ? `変更 (${task.filesChanged})` : "変更",
            },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cx(
              "flex-1 cursor-pointer border-b-2 px-4 py-2.5 text-sm font-medium",
              tab === t.key
                ? "border-primary text-text"
                : "border-transparent text-faint hover:text-muted",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {stream.sessionError && (
        <div className="shrink-0 border-b border-danger/30 bg-danger-bg px-4 py-2 text-sm text-danger">
          {stream.sessionError}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Chat column */}
        <div
          className={cx(
            "min-w-0 flex-1 flex-col",
            chatVisible ? "flex" : "hidden lg:flex",
          )}
        >
          {!task.sessionId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
              <p className="text-sm text-muted">
                この Workspace にはまだセッションがありません。
              </p>
              <Button variant="primary" onClick={() => void ensureSession()}>
                セッションを開始
              </Button>
            </div>
          ) : (
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="flex-1 overflow-y-auto overscroll-contain"
            >
              <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
                {!stream.loaded && (
                  <div className="flex justify-center py-10">
                    <Spinner />
                  </div>
                )}
                {timeline.map((m) => (
                  <div key={m.info.id} className="flex flex-col gap-2">
                    {m.parts.map((p) => (
                      <PartView
                        key={p.id}
                        part={p}
                        role={m.info.role}
                        onFileClick={openFileInDiff}
                      />
                    ))}
                    {m.info.error?.data?.message && (
                      <p className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger">
                        {m.info.error.data.message}
                      </p>
                    )}
                  </div>
                ))}
                {stream.permissions.map((p) => (
                  <PermissionCard
                    key={p.id}
                    request={p}
                    onReply={stream.replyPermission}
                  />
                ))}
                {working && (
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin text-working" />
                    {stream.status?.type === "retry"
                      ? `リトライ中… ${stream.status.message ?? ""}`
                      : "作業中…"}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Composer */}
          <div className="shrink-0 border-t border-border bg-surface px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto max-w-3xl">
              <TodoPanel todos={stream.todos} />
              {sendError && (
                <p className="mt-2 rounded-lg border border-danger/30 bg-danger-bg px-3 py-1.5 text-xs text-danger">
                  {sendError}
                </p>
              )}
              <div className="mt-2 flex items-end gap-2 rounded-2xl border border-border bg-bg px-3 py-2 focus-within:border-border-strong">
                <textarea
                  ref={textareaRef}
                  value={input}
                  rows={1}
                  disabled={!task.sessionId}
                  onChange={(e) => {
                    setInput(e.target.value);
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                  }}
                  onCompositionStart={() => (composingRef.current = true)}
                  onCompositionEnd={() => (composingRef.current = false)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !composingRef.current
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="フォローアップを送信…"
                  className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-[0.925rem] outline-none placeholder:text-faint"
                />
                {working ? (
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="停止"
                    onClick={() => void stream.abort()}
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="icon"
                    aria-label="送信"
                    disabled={!input.trim() || !task.sessionId}
                    onClick={() => void send()}
                  >
                    <ArrowUp className="h-4.5 w-4.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Diff pane */}
        <div
          className={cx(
            "min-w-0 flex-col border-border",
            diffVisible ? "flex flex-1" : "hidden",
            showDiff
              ? "lg:flex lg:w-[46%] lg:max-w-[720px] lg:flex-none lg:border-l"
              : "lg:hidden",
          )}
        >
          <DiffPane
            directory={task.directory}
            refreshKey={diffKey}
            focusFile={focusFile}
            onFocusHandled={() => setFocusFile(null)}
            onMutated={() => void refreshTask()}
          />
        </div>
      </div>
    </div>
  );
}
