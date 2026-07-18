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
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  Cpu,
  FolderTree,
  GitBranch,
  GitGraph,
  ListTodo,
  Loader2,
  PanelRight,
  RefreshCw,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";
import { AccessModeSelect } from "@/components/AccessModeSelect";
import { StatusBadge } from "@/components/StatusBadge";
import { notifyTasksChanged } from "@/lib/events";
import {
  useShellExtras,
  useShellSetActiveScope,
} from "@/components/shell/ShellContext";
import { Button, GhostSelect, Spinner, cx } from "@/components/ui";
import {
  readAccessMode,
  writeAccessMode,
  type AccessMode,
} from "@/lib/access-mode";
import { getJson, ocJson, sendJson } from "@/lib/client";
import { copyText } from "@/lib/clipboard";
import { applyFaviconBadge } from "@/lib/favicon-badge";
import { decideNotification, notificationText } from "@/lib/notify";
import { useSessionStream } from "@/lib/useSessionStream";
import type { TaskSummary, Todo } from "@/lib/types";
import { DiffPane } from "./DiffPane";
import { FileTreePanel } from "./FileTreePanel";
import { GraphPanel } from "./GraphPanel";
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

const SIDE_WIDTH_KEY = "webui.sidepanel.width";
const SIDE_DEFAULT = 520;
const SIDE_MIN = 280;
const SIDE_MAX = 900;

function clampSideWidth(n: number) {
  return Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(n)));
}

function loadSideWidth(): number {
  try {
    const raw = localStorage.getItem(SIDE_WIDTH_KEY);
    if (!raw) return SIDE_DEFAULT;
    const n = Number(raw);
    return Number.isFinite(n) ? clampSideWidth(n) : SIDE_DEFAULT;
  } catch {
    return SIDE_DEFAULT;
  }
}

function saveSideWidth(n: number) {
  try {
    localStorage.setItem(SIDE_WIDTH_KEY, String(clampSideWidth(n)));
  } catch {
    /* ignore */
  }
}

export function TaskView({ taskId }: { taskId: string }) {
  const router = useRouter();
  const { setExtras } = useShellExtras();
  const setActiveScope = useShellSetActiveScope();
  const [task, setTask] = useState<TaskSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "diff">("chat");
  const [showDiff, setShowDiff] = useState(true);
  const [sidePanel, setSidePanel] = useState<"diff" | "files" | "pty" | "graph">(
    "diff",
  );
  const [sideWidth, setSideWidth] = useState(SIDE_DEFAULT);
  const [sideResizing, setSideResizing] = useState(false);
  const [isLg, setIsLg] = useState(false);
  const sideDragRef = useRef<{ x: number; w: number } | null>(null);
  const [diffKey, setDiffKey] = useState(0);
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [agent, setAgent] = useState("");
  const [accessMode, setAccessMode] = useState<AccessMode>("ask");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const composingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoReplyIdsRef = useRef<Set<string>>(new Set());

  const stream = useSessionStream(
    task?.directory ?? null,
    task?.sessionId ?? null,
  );

  useEffect(() => {
    setSideWidth(loadSideWidth());
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsLg(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!sideResizing) return;
    const onMove = (e: PointerEvent) => {
      const start = sideDragRef.current;
      if (!start) return;
      setSideWidth(clampSideWidth(start.w + (start.x - e.clientX)));
    };
    const onUp = () => {
      setSideResizing(false);
      sideDragRef.current = null;
      setSideWidth((w) => {
        saveSideWidth(w);
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
  }, [sideResizing]);

  useEffect(() => {
    setAccessMode(readAccessMode());
    const onMode = (e: Event) => {
      const detail = (e as CustomEvent<AccessMode>).detail;
      if (detail === "ask" || detail === "full") setAccessMode(detail);
    };
    window.addEventListener("webui:access-mode", onMode);
    return () => window.removeEventListener("webui:access-mode", onMode);
  }, []);

  const changeAccessMode = useCallback((mode: AccessMode) => {
    setAccessMode(mode);
    writeAccessMode(mode);
  }, []);

  const { permissions, replyPermission } = stream;

  // フルアクセス: pending 権限を自動承認
  useEffect(() => {
    if (accessMode !== "full") {
      autoReplyIdsRef.current.clear();
      return;
    }
    for (const p of permissions) {
      if (autoReplyIdsRef.current.has(p.id)) continue;
      autoReplyIdsRef.current.add(p.id);
      void replyPermission(p, "once").catch(() => {
        autoReplyIdsRef.current.delete(p.id);
      });
    }
  }, [accessMode, permissions, replyPermission]);

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
    const wasBusy =
      prevStatusRef.current === "busy" || prevStatusRef.current === "retry";
    const nowIdle = cur === "idle" || cur === null;
    if (wasBusy && nowIdle) {
      setDiffKey((k) => k + 1);
      void refreshTask();
    }
    prevStatusRef.current = cur;
  }, [stream.status, refreshTask]);

  // Refresh Diff when patch / edit tools land in the timeline
  const patchSignature = useMemo(() => {
    let n = 0;
    for (const m of stream.messages) {
      for (const p of m.parts) {
        if (p.type === "patch") n += 1 + (p.files?.length ?? 0);
        if (
          p.type === "tool" &&
          (p.tool === "edit" ||
            p.tool === "write" ||
            p.tool === "apply_patch" ||
            p.tool === "multiedit") &&
          p.state?.status === "completed"
        ) {
          n += 1;
        }
      }
    }
    return n;
  }, [stream.messages]);
  const prevPatchRef = useRef(0);
  useEffect(() => {
    if (patchSignature > prevPatchRef.current) {
      setDiffKey((k) => k + 1);
    }
    prevPatchRef.current = patchSignature;
  }, [patchSignature]);

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

  // Prefer last *visible* user message for header revert
  const lastRevertMessageId = useMemo(() => {
    const msgs = stream.visibleMessages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m?.info.role === "user" && m.info.id) return m.info.id;
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
      const id = msgs[i]?.info.id;
      if (id) return id;
    }
    return null;
  }, [stream.visibleMessages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || working) return;
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
  }, [input, working, stream, model, agent]);

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
    const ok = await copyText(task.directory);
    if (!ok) return;
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

  // Tab title + favicon badge notification for approvals / working
  useEffect(() => {
    const base = task?.title ? `${task.title} · OpenCode` : "OpenCode WebUI";
    const needsAttention =
      stream.permissions.length > 0 || stream.questions.length > 0;
    if (needsAttention) {
      document.title = `(要確認) ${base}`;
      applyFaviconBadge("attention");
    } else if (working) {
      document.title = `(実行中) ${base}`;
      applyFaviconBadge("working");
    } else {
      document.title = base;
      applyFaviconBadge("idle");
    }
    return () => {
      document.title = "OpenCode WebUI";
      applyFaviconBadge("idle");
    };
  }, [
    task?.title,
    working,
    stream.permissions.length,
    stream.questions.length,
  ]);

  // Desktop notifications when the tab is backgrounded
  const prevWorkingRef = useRef(false);
  const prevAttentionRef = useRef(false);
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    const attention =
      stream.permissions.length > 0 || stream.questions.length > 0;

    if (
      Notification.permission === "default" &&
      (working || attention)
    ) {
      void Notification.requestPermission().catch(() => undefined);
    }

    const kind = decideNotification({
      prevAttention: prevAttentionRef.current,
      attention,
      prevWorking: prevWorkingRef.current,
      working,
      documentHidden:
        typeof document !== "undefined" ? document.hidden : false,
      permission: Notification.permission,
    });
    if (kind) {
      const { title, body } = notificationText(kind, task?.title ?? "");
      try {
        new Notification(title, { body, tag: `task-${task?.id ?? "x"}` });
      } catch {
        // ignore construction errors (e.g. unsupported context)
      }
    }

    prevWorkingRef.current = working;
    prevAttentionRef.current = attention;
  }, [
    working,
    stream.permissions.length,
    stream.questions.length,
    task?.title,
    task?.id,
  ]);

  const restoreToComposer = useCallback((text: string) => {
    setInput(text);
    stickRef.current = true;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
      el.focus();
      const len = text.length;
      el.setSelectionRange(len, len);
    });
  }, []);

  const openFileInDiff = useCallback(
    (path: string) => {
      const root = task?.directory ?? "";
      let rel = path.replace(/\\/g, "/");
      if (root) {
        const rootNorm = root.replace(/\\/g, "/").replace(/\/+$/, "");
        if (rel.toLowerCase().startsWith(rootNorm.toLowerCase() + "/")) {
          rel = rel.slice(rootNorm.length + 1);
        } else if (rel.toLowerCase() === rootNorm.toLowerCase()) {
          rel = "";
        }
      }
      rel = rel.replace(/^\.?\//, "");
      if (rel) setFocusFile(rel);
      setShowDiff(true);
      setTab("diff");
      setSidePanel("diff");
    },
    [task?.directory],
  );

  useEffect(() => {
    if (!task?.directory) {
      setExtras({});
      return;
    }
    setExtras({ directory: task.directory, onFile: openFileInDiff });
    return () => setExtras({});
  }, [task?.directory, openFileInDiff, setExtras]);

  useEffect(() => {
    if (task?.directory && task?.sessionId) {
      setActiveScope({ directory: task.directory, sessionId: task.sessionId });
    } else {
      setActiveScope(null);
    }
    return () => setActiveScope(null);
  }, [task?.directory, task?.sessionId, setActiveScope]);

  const timeline = useMemo(
    () =>
      stream.visibleMessages.filter((m) =>
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
    [stream.visibleMessages],
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
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">
              {task.title}
            </h1>
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
        <div className="flex max-w-[55vw] shrink-0 items-center gap-0.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] sm:max-w-none sm:gap-1 [&::-webkit-scrollbar]:hidden">
          {working && (
            <Button variant="danger" size="sm" onClick={() => void stream.abort()}>
              <Square className="h-3 w-3 fill-current" />
              <span className="hidden sm:inline">停止</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:inline-flex"
            title={copied ? "コピーしました" : "作業パスをコピー"}
            onClick={() => void copyPath()}
          >
            {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:inline-flex"
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
                lastUserMessageId={lastRevertMessageId}
                messages={stream.visibleMessages}
                onRestoreText={restoreToComposer}
                onDone={() => {
                  void stream.resync();
                  setDiffKey((k) => k + 1);
                }}
              />
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:inline-flex"
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
              showDiff && sidePanel === "files" && "bg-surface-2 text-text",
            )}
            onClick={() => {
              setShowDiff(true);
              setTab("diff");
              setSidePanel("files");
            }}
          >
            <FolderTree className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="グラフ"
            className={cx(
              showDiff && sidePanel === "graph" && "bg-surface-2 text-text",
            )}
            onClick={() => {
              setShowDiff(true);
              setTab("diff");
              setSidePanel("graph");
            }}
          >
            <GitGraph className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="ターミナル"
            className={cx(
              "hidden md:inline-flex",
              showDiff && sidePanel === "pty" && "bg-surface-2 text-text",
            )}
            onClick={() => {
              setShowDiff(true);
              setTab("diff");
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
              showDiff && sidePanel === "diff" && "bg-surface-2 text-text",
            )}
            onClick={() => {
              if (sidePanel === "diff" && showDiff && tab === "diff") {
                setShowDiff(false);
                setTab("chat");
              } else {
                setSidePanel("diff");
                setShowDiff(true);
                setTab("diff");
              }
            }}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Mobile tabs */}
      <div className="flex shrink-0 overflow-x-auto border-b border-border bg-surface [-ms-overflow-style:none] [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
        {(
          [
            { key: "chat" as const, label: "会話", panel: null },
            {
              key: "diff" as const,
              label:
                task.filesChanged > 0 ? `変更 (${task.filesChanged})` : "変更",
              panel: "diff" as const,
            },
            { key: "diff" as const, label: "ファイル", panel: "files" as const },
            { key: "diff" as const, label: "グラフ", panel: "graph" as const },
          ] as const
        ).map((t) => {
          const active =
            tab === t.key &&
            (t.panel === null || sidePanel === t.panel);
          return (
            <button
              key={`${t.key}-${t.panel ?? "main"}`}
              type="button"
              onClick={() => {
                setTab(t.key);
                if (t.panel) {
                  setSidePanel(t.panel);
                  setShowDiff(true);
                }
              }}
              className={cx(
                "shrink-0 cursor-pointer border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap",
                active
                  ? "border-primary text-text"
                  : "border-transparent text-faint hover:text-muted",
              )}
            >
              {t.label}
            </button>
          );
        })}
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
              {stream.revert && (
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-warning/30 bg-warning-bg px-4 py-2 text-sm text-warning">
                  <span>巻き戻し中（以降のメッセージは非表示）</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void (async () => {
                        try {
                          const { unrevertSession } = await import(
                            "./SessionActions"
                          );
                          await unrevertSession(task.directory, task.sessionId!);
                          await stream.resync();
                          setDiffKey((k) => k + 1);
                        } catch (err) {
                          window.alert(
                            err instanceof Error
                              ? err.message
                              : "復元に失敗しました",
                          );
                        }
                      })();
                    }}
                  >
                    復元
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
                      <div className="flex justify-end opacity-100 transition-opacity sm:opacity-0 sm:group-hover/msg:opacity-100">
                        <MessageRevertButton
                          directory={task.directory}
                          sessionId={task.sessionId}
                          messageId={m.info.id}
                          messages={stream.visibleMessages}
                          disabled={working}
                          onRestoreText={restoreToComposer}
                          onDone={() => {
                            void stream.resync();
                            setDiffKey((k) => k + 1);
                          }}
                        />
                      </div>
                    )}
                    {m.info.role === "assistant" &&
                      typeof m.info.cost === "number" &&
                      m.info.cost > 0 && (
                        <p className="break-all text-[10px] text-faint">
                          cost ${m.info.cost.toFixed(4)}
                          {m.info.modelID ? ` · ${m.info.modelID}` : ""}
                        </p>
                      )}
                    {m.info.error?.data?.message && (
                      <p className="break-all rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger">
                        {m.info.error.data.message}
                      </p>
                    )}
                  </div>
                ))}
                {accessMode === "ask" &&
                  stream.permissions.map((p) => (
                  <PermissionCard
                    key={p.id}
                    request={p}
                    onReply={stream.replyPermission}
                    onEnableFullAccess={() => changeAccessMode("full")}
                  />
                ))}
                {accessMode === "full" && stream.permissions.length > 0 && (
                  <p className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning">
                    フルアクセス: 権限要求を自動承認中…
                  </p>
                )}
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
                <p
                  role="alert"
                  className="mt-2 rounded-lg border border-danger/30 bg-danger-bg px-3 py-1.5 text-xs text-danger"
                >
                  {sendError}
                </p>
              )}
              <div className="mt-2 rounded-2xl border border-border bg-bg px-3 py-2 focus-within:border-border-strong focus-within:ring-2 focus-within:ring-primary/20">
                <textarea
                  ref={textareaRef}
                  value={input}
                  rows={1}
                  disabled={!task.sessionId}
                  readOnly={working}
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
                      !working &&
                      !composingRef.current
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="フォローアップを送信…"
                  className="max-h-40 w-full resize-none bg-transparent py-1.5 text-[0.925rem] outline-none placeholder:text-faint"
                />
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <AccessModeSelect
                      value={accessMode}
                      onChange={changeAccessMode}
                      disabled={!task.sessionId}
                      className="h-8 shrink-0"
                    />
                    {modelOptions.length > 0 && (
                      <GhostSelect
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        disabled={!task.sessionId || working}
                        aria-label="モデル"
                        icon={<Cpu className="h-3.5 w-3.5" />}
                        valueLabel={
                          modelOptions.find((o) => o.value === model)?.label ??
                          "モデル"
                        }
                        className="max-w-[11rem] shrink-0 sm:max-w-48"
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
                      </GhostSelect>
                    )}
                    {agents.length > 0 && (
                      <GhostSelect
                        value={agent}
                        onChange={(e) => setAgent(e.target.value)}
                        disabled={!task.sessionId || working}
                        aria-label="エージェント"
                        icon={<Bot className="h-3.5 w-3.5" />}
                        valueLabel={agent || "エージェント"}
                        className="max-w-[10rem] shrink-0 sm:max-w-40"
                      >
                        {agents.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </GhostSelect>
                    )}
                  </div>
                  {working ? (
                    <Button
                      variant="secondary"
                      size="icon"
                      className="shrink-0"
                      aria-label="停止"
                      onClick={() => void stream.abort()}
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="icon"
                      className="shrink-0"
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

        {/* Diff / files / graph / pty pane */}
        <div
          className={cx(
            "relative min-h-0 min-w-0 flex-col border-border",
            diffVisible ? "flex flex-1" : "hidden",
            showDiff
              ? "lg:flex lg:flex-none lg:border-l"
              : "lg:hidden",
          )}
          style={showDiff && isLg ? { width: sideWidth } : undefined}
        >
          {showDiff && isLg && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="右パネル幅を調整"
              aria-valuenow={sideWidth}
              aria-valuemin={SIDE_MIN}
              aria-valuemax={SIDE_MAX}
              title="ドラッグで幅を変更（ダブルクリックでリセット）"
              onPointerDown={(e) => {
                e.preventDefault();
                sideDragRef.current = { x: e.clientX, w: sideWidth };
                setSideResizing(true);
              }}
              onDoubleClick={() => {
                setSideWidth(SIDE_DEFAULT);
                saveSideWidth(SIDE_DEFAULT);
              }}
              className={cx(
                "absolute top-0 left-0 z-10 hidden h-full w-1.5 -translate-x-1/2 cursor-col-resize touch-none lg:block",
                "hover:bg-accent/40 active:bg-accent/60",
                sideResizing && "bg-accent/50",
              )}
            />
          )}
          {sidePanel === "diff" && (
            <div className="flex min-h-0 w-full flex-1 flex-col">
              <DiffPane
                directory={task.directory}
                workspaceId={task.id}
                refreshKey={diffKey}
                focusFile={focusFile}
                onFocusHandled={() => setFocusFile(null)}
                onMutated={() => void refreshTask()}
              />
            </div>
          )}
          {sidePanel === "files" && (
            <div className="flex min-h-0 w-full flex-1">
              <FileTreePanel
                root={task.directory}
                onFile={(p) => {
                  openFileInDiff(p);
                }}
              />
            </div>
          )}
          {sidePanel === "graph" && (
            <div className="flex min-h-0 w-full flex-1">
              <GraphPanel directory={task.directory} />
            </div>
          )}
          {sidePanel === "pty" && (
            <div className="flex min-h-0 w-full flex-1">
              <PtyPanel directory={task.directory} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
