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
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  FolderTree,
  GitBranch,
  ListTodo,
  Loader2,
  PanelRight,
  RefreshCw,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { notifyTasksChanged } from "@/lib/events";
import { useShellExtras } from "@/components/shell/ShellContext";
import { Button, Spinner, cx } from "@/components/ui";
import { getJson, ocJson, sendJson } from "@/lib/client";
import { useSessionStream } from "@/lib/useSessionStream";
import type { TaskSummary, Todo } from "@/lib/types";
import { DiffPane } from "./DiffPane";
import { FileTreePanel } from "./FileTreePanel";
import { PartView } from "./PartView";
import { PermissionCard } from "./PermissionCard";
import { PtyPanel } from "./PtyPanel";
import { QuestionCard } from "./QuestionCard";
import { SessionActions, MessageRevertButton } from "./SessionActions";
import { SessionSwitcher } from "./SessionSwitcher";

type ModelOption = { value: string; label: string; group: string };

type ProviderResponse = {
  all: { id: string; name: string; models: Record<string, { name?: string }> }[];
  connected: string[];
  default: Record<string, string>;
};

type AgentResponse = { name: string; mode?: string; hidden?: boolean }[];

function TodoPanel({
  todos,
  forceOpen,
}: {
  todos: Todo[];
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(forceOpen));
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  const done = todos.filter((t) => t.status === "completed").length;
  const active = todos.filter((t) => t.status === "in_progress").length;
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
        {active > 0 && (
          <span className="rounded-full bg-working/15 px-1.5 py-0.5 text-[10px] text-working">
            進行中 {active}
          </span>
        )}
        <ChevronRight
          className={cx("h-3 w-3 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <ul className="space-y-1 border-t border-border px-3 py-2">
          {todos.map((t, i) => (
            <li
              key={t.id ?? `${t.content ?? "todo"}-${i}`}
              className="flex items-start gap-2 text-xs"
            >
              {t.status === "completed" ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              ) : t.status === "in_progress" ? (
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-working" />
              ) : t.status === "cancelled" ? (
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
              ) : (
                <span className="mt-1 ml-0.5 h-2 w-2 shrink-0 rounded-full border border-faint" />
              )}
              <span
                className={cx(
                  t.status === "completed" || t.status === "cancelled"
                    ? "text-faint line-through"
                    : "text-muted",
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
  const { setExtras } = useShellExtras();
  const [task, setTask] = useState<TaskSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "diff">("chat");
  const [showDiff, setShowDiff] = useState(true);
  const [sidePanel, setSidePanel] = useState<"diff" | "files" | "pty">("diff");
  const [diffKey, setDiffKey] = useState(0);
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [agent, setAgent] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const composingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const stream = useSessionStream(
    task?.directory ?? null,
    task?.sessionId ?? null,
  );

  useEffect(() => {
    void (async () => {
      try {
        const [providerRes, configRes, agentRes] = await Promise.all([
          fetch("/api/opencode/provider", { cache: "no-store" }),
          fetch("/api/opencode/config", { cache: "no-store" }),
          fetch("/api/opencode/agent", { cache: "no-store" }),
        ]);

        const data = providerRes.ok
          ? ((await providerRes.json()) as ProviderResponse)
          : null;
        const config = configRes.ok
          ? ((await configRes.json()) as { model?: string; agent?: unknown })
          : null;

        if (data) {
          const connectedList = data.connected ?? [];
          const connected = new Set(connectedList);
          const options: ModelOption[] = [];
          for (const p of data.all ?? []) {
            if (connected.size > 0 && !connected.has(p.id)) continue;
            for (const [mid, m] of Object.entries(p.models ?? {})) {
              options.push({
                value: `${p.id}::${mid}`,
                label: m.name || mid,
                group: p.name || p.id,
              });
            }
          }
          setModelOptions(options);

          let initial = "";
          const cfg = config?.model?.trim();
          if (cfg) {
            const slash = cfg.indexOf("/");
            if (slash > 0) {
              const value = `${cfg.slice(0, slash)}::${cfg.slice(slash + 1)}`;
              if (options.some((o) => o.value === value)) initial = value;
            }
          }
          if (!initial) {
            for (const pid of connectedList) {
              const mid = data.default?.[pid];
              if (!mid) continue;
              const value = `${pid}::${mid}`;
              if (options.some((o) => o.value === value)) {
                initial = value;
                break;
              }
            }
          }
          if (!initial && options[0]) initial = options[0].value;
          setModel((cur) => cur || initial);
        }

        if (agentRes.ok) {
          const agentsData = (await agentRes.json()) as AgentResponse;
          const names = agentsData
            .filter((a) => a.mode !== "subagent" && !a.hidden)
            .map((a) => a.name);
          setAgents(names);
          const cfgAgent =
            typeof config?.agent === "string" ? config.agent : undefined;
          const initial = names.includes(cfgAgent ?? "")
            ? (cfgAgent as string)
            : names.includes("build")
              ? "build"
              : (names[0] ?? "");
          setAgent((cur) => cur || initial);
        }
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

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
  }, [stream.messages, stream.permissions, stream.questions, stream.status]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
  }, []);

  const working = stream.status !== null && stream.status.type !== "idle";

  const currentTool = useMemo(() => {
    for (let i = stream.messages.length - 1; i >= 0; i--) {
      const parts = stream.messages[i]?.parts ?? [];
      for (let j = parts.length - 1; j >= 0; j--) {
        const p = parts[j];
        if (
          p?.type === "tool" &&
          (p.state?.status === "running" || p.state?.status === "pending")
        ) {
          const tool = p.tool ?? "tool";
          const title = p.state?.title ?? tool;
          return title;
        }
      }
    }
    return null;
  }, [stream.messages]);

  const todoBadge = useMemo(() => {
    if (stream.todos.length === 0) return null;
    const done = stream.todos.filter((t) => t.status === "completed").length;
    return `${done}/${stream.todos.length}`;
  }, [stream.todos]);

  // Prefer last user message for header revert (undo that turn + after)
  const lastRevertMessageId = useMemo(() => {
    const msgs = stream.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m?.info.role === "user" && m.info.id) return m.info.id;
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
      const id = msgs[i]?.info.id;
      if (id) return id;
    }
    return null;
  }, [stream.messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setSendError(null);
    stickRef.current = true;
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    try {
      const [providerID, modelID] = model ? model.split("::") : [];
      await stream.sendPrompt(text, {
        ...(agent ? { agent } : {}),
        ...(providerID && modelID ? { model: { providerID, modelID } } : {}),
      });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "送信に失敗しました");
      setInput(text);
    }
  }, [input, stream, model, agent]);

  // Prefer last assistant message's model once stream is loaded
  const seededModelRef = useRef(false);
  useEffect(() => {
    if (seededModelRef.current || !stream.loaded || modelOptions.length === 0) return;
    for (let i = stream.messages.length - 1; i >= 0; i--) {
      const info = stream.messages[i]?.info;
      if (info?.role !== "assistant" || !info.providerID || !info.modelID) continue;
      const value = `${info.providerID}::${info.modelID}`;
      if (modelOptions.some((o) => o.value === value)) {
        setModel(value);
        seededModelRef.current = true;
      }
      break;
    }
  }, [stream.loaded, stream.messages, modelOptions]);

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
      notifyTasksChanged();
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

  // Tab title notification for approvals / working
  useEffect(() => {
    const base = task?.title ? `${task.title} · OpenCode` : "OpenCode WebUI";
    if (stream.permissions.length > 0 || stream.questions.length > 0) {
      document.title = `(要確認) ${base}`;
    } else if (working) {
      document.title = `(実行中) ${base}`;
    } else {
      document.title = base;
    }
    return () => {
      document.title = "OpenCode WebUI";
    };
  }, [
    task?.title,
    working,
    stream.permissions.length,
    stream.questions.length,
  ]);

  const openFileInDiff = useCallback((path: string) => {
    setFocusFile(path);
    setShowDiff(true);
    setTab("diff");
  }, []);

  useEffect(() => {
    if (!task?.directory) {
      setExtras({});
      return;
    }
    setExtras({ directory: task.directory, onFile: openFileInDiff });
    return () => setExtras({});
  }, [task?.directory, openFileInDiff, setExtras]);

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
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
        <p className="text-sm text-danger">{loadError}</p>
        <Link href="/" className="text-sm text-accent underline">
          ホームへ戻る
        </Link>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const chatVisible = tab === "chat";
  const diffVisible = tab === "diff";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold">{task.title}</h1>
            <StatusBadge status={working ? "working" : task.status} />
            {working && currentTool && (
              <span className="hidden max-w-[12rem] truncate text-xs text-working sm:inline">
                {currentTool}
              </span>
            )}
            {todoBadge && (
              <span className="hidden items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted sm:inline-flex">
                <ListTodo className="h-3 w-3" />
                {todoBadge}
              </span>
            )}
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
          {task.sessionId && (
            <>
              <SessionSwitcher
                workspaceId={task.id}
                directory={task.directory}
                currentSessionId={task.sessionId}
                onSwitch={() => void refreshTask()}
              />
              <SessionActions
                directory={task.directory}
                sessionId={task.sessionId}
                lastMessageId={lastRevertMessageId}
                onDone={() => void stream.resync()}
              />
            </>
          )}
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
            title="ファイルツリー"
            className={cx(
              "hidden lg:inline-flex",
              showDiff && sidePanel === "files" && "bg-surface-2 text-text",
            )}
            onClick={() => {
              setShowDiff(true);
              setSidePanel("files");
            }}
          >
            <FolderTree className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="ターミナル"
            className={cx(
              "hidden lg:inline-flex",
              showDiff && sidePanel === "pty" && "bg-surface-2 text-text",
            )}
            onClick={() => {
              setShowDiff(true);
              setSidePanel("pty");
            }}
          >
            <Terminal className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Diff パネル"
            className={cx(
              "hidden lg:inline-flex",
              showDiff && sidePanel === "diff" && "bg-surface-2 text-text",
            )}
            onClick={() => {
              setShowDiff((v) => (sidePanel === "diff" ? !v : true));
              setSidePanel("diff");
            }}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
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
            <>
              {task.status === "merged" && (
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-success/30 bg-success-bg px-4 py-2 text-sm text-success">
                  <span>マージ済み — worktree を削除できます</span>
                  <Button variant="danger" size="sm" onClick={() => void removeTask()}>
                    クリーンアップ
                  </Button>
                </div>
              )}
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
                  <div key={m.info.id} className="group/msg flex flex-col gap-2">
                    {m.parts.map((p) => (
                      <PartView
                        key={p.id}
                        part={p}
                        role={m.info.role}
                        onFileClick={openFileInDiff}
                        directory={task.directory}
                        rootSessionId={task.sessionId}
                      />
                    ))}
                    {m.info.role === "user" && task.sessionId && (
                      <div className="flex justify-end opacity-0 transition-opacity group-hover/msg:opacity-100">
                        <MessageRevertButton
                          directory={task.directory}
                          sessionId={task.sessionId}
                          messageId={m.info.id}
                          disabled={working}
                          onDone={() => void stream.resync()}
                        />
                      </div>
                    )}
                    {m.info.role === "assistant" &&
                      typeof m.info.cost === "number" &&
                      m.info.cost > 0 && (
                        <p className="text-[10px] text-faint">
                          cost ${m.info.cost.toFixed(4)}
                          {m.info.modelID ? ` · ${m.info.modelID}` : ""}
                        </p>
                      )}
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
                {stream.questions.map((q) => (
                  <QuestionCard
                    key={q.id}
                    request={q}
                    onReply={stream.replyQuestion}
                    onReject={stream.rejectQuestion}
                  />
                ))}
                {working && stream.questions.length === 0 && (
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin text-working" />
                    {stream.status?.type === "retry"
                      ? `リトライ中… ${stream.status.message ?? ""}`
                      : currentTool
                        ? `${currentTool}…`
                        : "作業中…"}
                  </div>
                )}
              </div>
            </div>
            </>
          )}

          {/* Composer */}
          <div className="shrink-0 border-t border-border bg-surface px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto max-w-3xl">
              <TodoPanel todos={stream.todos} forceOpen={working} />
              {sendError && (
                <p className="mt-2 rounded-lg border border-danger/30 bg-danger-bg px-3 py-1.5 text-xs text-danger">
                  {sendError}
                </p>
              )}
              <div className="mt-2 rounded-2xl border border-border bg-bg px-3 py-2 focus-within:border-border-strong">
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
                  className="max-h-40 w-full resize-none bg-transparent py-1.5 text-[0.925rem] outline-none placeholder:text-faint"
                />
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {modelOptions.length > 0 && (
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={!task.sessionId || working}
                      className="h-8 max-w-40 cursor-pointer rounded-lg border border-border bg-surface-2 px-2 text-xs font-medium text-muted outline-none hover:text-text disabled:opacity-50"
                    >
                      {[...new Set(modelOptions.map((o) => o.group))].map(
                        (group) => (
                          <optgroup key={group} label={group}>
                            {modelOptions
                              .filter((o) => o.group === group)
                              .map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                          </optgroup>
                        ),
                      )}
                    </select>
                  )}
                  {agents.length > 0 && (
                    <select
                      value={agent}
                      onChange={(e) => setAgent(e.target.value)}
                      disabled={!task.sessionId || working}
                      className="h-8 max-w-36 cursor-pointer rounded-lg border border-border bg-surface-2 px-2 text-xs font-medium text-muted outline-none hover:text-text disabled:opacity-50"
                    >
                      {agents.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="flex-1" />
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
          {sidePanel === "diff" && (
            <DiffPane
              directory={task.directory}
              workspaceId={task.id}
              refreshKey={diffKey}
              focusFile={focusFile}
              onFocusHandled={() => setFocusFile(null)}
              onMutated={() => void refreshTask()}
            />
          )}
          {sidePanel === "files" && (
            <div className="hidden min-h-0 w-full flex-1 lg:flex">
              <FileTreePanel
                root={task.directory}
                onFile={(p) => {
                  const rel = p.startsWith(task.directory)
                    ? p.slice(task.directory.length).replace(/^[\\/]/, "")
                    : p;
                  openFileInDiff(rel.replace(/\\/g, "/"));
                  setSidePanel("diff");
                }}
              />
            </div>
          )}
          {sidePanel === "pty" && (
            <div className="hidden min-h-0 w-full flex-1 lg:flex">
              <PtyPanel directory={task.directory} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
