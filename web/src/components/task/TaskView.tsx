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
  Layers,
  ListTodo,
  Loader2,
  Paperclip,
  PanelRight,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { AccessModeSelect } from "@/components/AccessModeSelect";
import { IntelligenceSelect } from "@/components/IntelligenceSelect";
import { StatusBadge } from "@/components/StatusBadge";
import { notifyTasksChanged } from "@/lib/events";
import { setActiveSessionAttention } from "@/lib/active-session-attention";
import {
  useShellExtras,
  useShellSetActiveScope,
} from "@/components/shell/ShellContext";
import { useOptionalGlobalAttention } from "@/components/shell/GlobalAttentionProvider";
import { Button, GhostSelect, Spinner, cx, formatMessageTime } from "@/components/ui";
import {
  readAccessMode,
  writeAccessMode,
  type AccessMode,
} from "@/lib/access-mode";
import {
  DEFAULT_MODEL_EVENT,
  readDefaultModel,
} from "@/lib/default-model";
import { formatTokens, providerIconSrcForOpencodeId } from "@addons/codexbar";
import { computeContextUsage } from "@/lib/context-usage";
import {
  readChatTab,
  readShowDiff,
  readSidePanel,
  writeChatTab,
  writeShowDiff,
  writeSidePanel,
  type ChatTab,
  type SidePanelKind,
} from "@/lib/side-panel-state";
import { getJson, ocJson, sendJson, timedFetch } from "@/lib/client";
import { copyText } from "@/lib/clipboard";
import { formatCostValue, useCostDisplayPrefs } from "@/lib/currency";
import { applyFaviconBadge } from "@/lib/favicon-badge";
import {
  formatModelLabel,
  sortModelOptions,
  type ModelOption,
} from "@/lib/model-options";
import {
  getIntelligenceVariants,
  isIntelligenceVariant,
  type IntelligenceVariant,
  type ProviderModelMeta,
} from "@/lib/model-variants";
import { decideNotification, notificationText } from "@/lib/notify";
import {
  extractPlanMarkdownPath,
  isPlanApproved,
  PLAN_APPROVAL_PROMPT,
} from "@/lib/plan-document";
import { collectTaskCallIds } from "@/lib/match-child-session";
import {
  applySlashCompletion,
  filterCommands,
  parseCommandSubmit,
  parseSlashQuery,
} from "@/lib/slash-command";
import { useSessionStream } from "@/lib/useSessionStream";
import { useSlashCommands } from "@/lib/useSlashCommands";
import { useVoiceInput } from "@/lib/use-voice-input";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import type { TaskSummary, Todo } from "@/lib/types";
import { DiffPane } from "./DiffPane";
import { FileTreePanel } from "./FileTreePanel";
import { SlashSuggestMenu } from "@/components/SlashSuggestMenu";
import { GraphPanel } from "./GraphPanel";
import { MessageMetaHeader } from "./MessageMetaHeader";
import { PartView } from "./PartView";
import { PlanDocumentCard } from "./PlanDocumentCard";
import { PermissionCard } from "./PermissionCard";
import { PtyPanel } from "./PtyPanel";
import { QuestionCard } from "./QuestionCard";
import {
  CompactButton,
  MessageRevertButton,
  useSessionActions,
} from "./SessionActions";
import { SessionSwitcherDialog } from "./SessionSwitcherDialog";
import {
  HeaderKebabMenu,
  type KebabGroup,
  type KebabItem,
} from "./HeaderKebabMenu";

type ProviderResponse = {
  all: {
    id: string;
    name: string;
    models: Record<
      string,
      {
        name?: string;
        // OpenCode's live GET /provider response nests capability flags
        // under `capabilities` (see opencode-schema.d.ts `Model.capabilities`
        // and `components["schemas"]["Model"]`), not top-level `attachment`/
        // `modalities.input[]` (that shape is only the *config* override
        // schema for opencode.jsonc `provider.<id>.models.<id>`). Reading
        // the old shape here always yields `undefined`, so every model was
        // reported as image-unsupported regardless of real capability.
        capabilities?: {
          attachment?: boolean;
          input?: {
            text?: boolean;
            audio?: boolean;
            image?: boolean;
            video?: boolean;
            pdf?: boolean;
          };
          output?: {
            text?: boolean;
            audio?: boolean;
            image?: boolean;
            video?: boolean;
            pdf?: boolean;
          };
        };
        variants?: ProviderModelMeta["variants"];
        limit?: ProviderModelMeta["limit"];
      }
    >;
  }[];
  connected: string[];
  default: Record<string, string>;
};

type AgentResponse = {
  name: string;
  mode?: string;
  hidden?: boolean;
  model?: { modelID: string; providerID: string };
}[];

type Attachment = { uri: string; mime: string; name?: string; preview?: string };

const IMAGE_MIME_RE = /^image\//i;

function ModelSelectIcon({ model }: { model: string }) {
  const providerID = model ? model.split("::")[0] : "";
  const src = providerIconSrcForOpencodeId(providerID);
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={14}
        height={14}
        className="h-3.5 w-3.5 shrink-0 rounded-[3px] object-contain"
        onError={() => setBroken(true)}
      />
    );
  }
  return <Cpu className="h-3.5 w-3.5" />;
}

function normalizedPlanPath(value: string | undefined) {
  if (!value) return null;
  let path = value.trim();
  if (path.startsWith("`") && path.endsWith("`") && path.length > 2) {
    path = path.slice(1, -1).trim();
  }
  return path;
}

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
/** Keep enough room for the chat column when the right panel is wide. */
const SIDE_CHAT_MIN = 320;
const ACTIVE_TASK_POLL_MS = 3000;

function clampSideWidth(n: number) {
  const viewport =
    typeof window !== "undefined" ? window.innerWidth : SIDE_MAX + SIDE_CHAT_MIN;
  const maxByViewport = Math.max(SIDE_MIN, viewport - SIDE_CHAT_MIN);
  return Math.min(SIDE_MAX, maxByViewport, Math.max(SIDE_MIN, Math.round(n)));
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
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const taskRef = useRef<TaskSummary | null>(null);
  const taskIdRef = useRef(taskId);
  const refreshSequenceRef = useRef(0);
  if (taskIdRef.current !== taskId) {
    taskIdRef.current = taskId;
    taskRef.current = null;
  }
  const [tab, setTab] = useState<ChatTab>("chat");
  const [showDiff, setShowDiff] = useState(true);
  const [sidePanel, setSidePanel] = useState<SidePanelKind>("diff");
  const [sideWidth, setSideWidth] = useState(SIDE_DEFAULT);
  const [sideResizing, setSideResizing] = useState(false);
  const [isLg, setIsLg] = useState(false);
  // Initialize from the actual matchMedia to avoid desktop permanent collapse
  // (isMd starts false on SSR/first paint, causing initialCollapsed=true on desktop).
  const [isMd, setIsMd] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 768px)").matches;
  });
  const sideDragRef = useRef<{ x: number; w: number } | null>(null);
  const [diffKey, setDiffKey] = useState(0);
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const modelLabels = useMemo<Readonly<Record<string, string>>>(
    () =>
      Object.fromEntries(
        modelOptions.map((option) => [option.value, option.label]),
      ),
    [modelOptions],
  );
  const [modelCapabilities, setModelCapabilities] = useState<
    Record<string, { attachment?: boolean; image?: boolean }>
  >({});
  const [agents, setAgents] = useState<string[]>([]);
  const [agentModels, setAgentModels] = useState<Record<string, { providerID: string; modelID: string }>>({});
  const [model, setModel] = useState("");
  const [agent, setAgent] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [intelligence, setIntelligence] = useState<IntelligenceVariant | "">("");
  const [providerModelsMap, setProviderModelsMap] = useState<
    Record<string, ProviderModelMeta>
  >({});
  const [accessMode, setAccessMode] = useState<AccessMode>("ask");
  const costPrefs = useCostDisplayPrefs();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const composingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoReplyIdsRef = useRef<Set<string>>(new Set());
  const [autoReplyFailedIds, setAutoReplyFailedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [cursor, setCursor] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const slashCommands = useSlashCommands(task?.directory ?? null);
  const slashQuery = useMemo(
    () => parseSlashQuery(input, cursor),
    [input, cursor],
  );
  const slashItems = useMemo(
    () =>
      slashQuery ? filterCommands(slashCommands, slashQuery.query) : [],
    [slashCommands, slashQuery],
  );
  const slashOpen = !slashDismissed && slashItems.length > 0;

  useEffect(() => {
    setSlashIndex(0);
    setSlashDismissed(false);
  }, [slashQuery?.query, slashQuery?.start]);

  const stream = useSessionStream(
    task?.directory ?? null,
    task?.sessionId ?? null,
  );

  useEffect(() => {
    setSideWidth(loadSideWidth());
    setTab(readChatTab());
    setShowDiff(readShowDiff());
    setSidePanel(readSidePanel());
    const mq = window.matchMedia("(min-width: 1024px)");
    const mqMd = window.matchMedia("(min-width: 768px)");
    const apply = () => {
      setIsLg(mq.matches);
      setIsMd(mqMd.matches);
      setSideWidth((w) => clampSideWidth(w));
    };
    apply();
    mq.addEventListener("change", apply);
    mqMd.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    return () => {
      mq.removeEventListener("change", apply);
      mqMd.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
    };
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

  // Sync default model when changed in Settings while a task is open and the
  // user has not manually picked a different model in this composer.
  useEffect(() => {
    const onDefault = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      const next = typeof detail === "string" && detail.length > 0 ? detail : "";
      if (!next) return;
      setModel((cur) => {
        if (cur && cur === next) return cur;
        if (modelOptions.some((o) => o.value === next)) return next;
        return cur;
      });
    };
    window.addEventListener(DEFAULT_MODEL_EVENT, onDefault);
    return () => window.removeEventListener(DEFAULT_MODEL_EVENT, onDefault);
  }, [modelOptions]);

  const changeAccessMode = useCallback((mode: AccessMode) => {
    setAccessMode(mode);
    writeAccessMode(mode);
  }, []);

  // Persist right-panel display state so it survives task/session switches.
  const changeTab = useCallback((next: ChatTab) => {
    setTab(next);
    writeChatTab(next);
  }, []);
  const changeShowDiff = useCallback((next: boolean) => {
    setShowDiff(next);
    writeShowDiff(next);
  }, []);
  const changeSidePanel = useCallback((next: SidePanelKind) => {
    setSidePanel(next);
    writeSidePanel(next);
  }, []);

  const { permissions, replyPermission, replyQuestion, rejectQuestion } = stream;
  const attention = useOptionalGlobalAttention();

  const onReplyPermission = useCallback(
    async (
      request: (typeof permissions)[number],
      response: "once" | "always" | "reject",
    ) => {
      await replyPermission(request, response);
      attention?.remove(request.id, request.sessionID);
    },
    [replyPermission, attention],
  );

  const onReplyQuestion = useCallback(
    async (
      request: Parameters<typeof replyQuestion>[0],
      answers: string[][],
    ) => {
      await replyQuestion(request, answers);
      attention?.remove(request.id, request.sessionID);
    },
    [replyQuestion, attention],
  );

  const onRejectQuestion = useCallback(
    async (request: Parameters<typeof rejectQuestion>[0]) => {
      await rejectQuestion(request);
      attention?.remove(request.id, request.sessionID);
    },
    [rejectQuestion, attention],
  );

  // Mobile/tablet: chat column is hidden on the diff tab, but active-session
  // permission/question cards only render inline there (not in the global modal).
  useEffect(() => {
    if (isLg || tab === "chat") return;
    if (permissions.length === 0 && stream.questions.length === 0) return;
    changeTab("chat");
  }, [isLg, tab, permissions.length, stream.questions.length, changeTab]);

  useEffect(() => {
    const sessionId = task?.sessionId ?? null;
    if (!sessionId) {
      setActiveSessionAttention(null);
      return;
    }
    setActiveSessionAttention({
      sessionId,
      permissions: permissions.length,
      questions: stream.questions.length,
    });
    return () => setActiveSessionAttention(null);
  }, [task?.sessionId, permissions.length, stream.questions.length]);


  // フルアクセス: pending 権限を自動承認（失敗時は手動カードへフォールバック）
  useEffect(() => {
    if (accessMode !== "full") {
      autoReplyIdsRef.current.clear();
      setAutoReplyFailedIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    for (const p of permissions) {
      if (autoReplyIdsRef.current.has(p.id)) continue;
      if (autoReplyFailedIds.has(p.id)) continue;
      autoReplyIdsRef.current.add(p.id);
      void onReplyPermission(p, "once")
        .then(() => {
          setAutoReplyFailedIds((prev) => {
            if (!prev.has(p.id)) return prev;
            const next = new Set(prev);
            next.delete(p.id);
            return next;
          });
        })
        .catch(() => {
          autoReplyIdsRef.current.delete(p.id);
          setAutoReplyFailedIds((prev) => {
            if (prev.has(p.id)) return prev;
            const next = new Set(prev);
            next.add(p.id);
            return next;
          });
        });
    }
  }, [accessMode, autoReplyFailedIds, permissions, onReplyPermission]);

  useEffect(() => {
    void (async () => {
      try {
        const [providerRes, configRes, agentRes] = await Promise.all([
          timedFetch("/api/opencode/provider"),
          timedFetch("/api/opencode/config"),
          timedFetch("/api/opencode/agent"),
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
          const caps: Record<string, { attachment?: boolean; image?: boolean }> = {};
          const map: Record<string, ProviderModelMeta> = {};
          for (const p of data.all ?? []) {
            if (connected.size > 0 && !connected.has(p.id)) continue;
            for (const [mid, m] of Object.entries(p.models ?? {})) {
              const value = `${p.id}::${mid}`;
              options.push({
                value,
                label: formatModelLabel(m.name, mid),
                group: p.name || p.id,
              });
              caps[value] = {
                attachment: m.capabilities?.attachment === true,
                image: m.capabilities?.input?.image === true,
              };
              map[`${p.id}::${mid}`] = {
                name: m.name,
                variants: m.variants,
                limit: m.limit,
              };
            }
          }
          setModelOptions(sortModelOptions(options));
          setModelCapabilities(caps);
          setProviderModelsMap(map);

          // Prefer user-configured default model, then OpenCode config.model
          // (provider/modelID), then provider defaults.
          let initial = "";
          const savedDefault = readDefaultModel();
          if (
            savedDefault &&
            options.some((o) => o.value === savedDefault)
          ) {
            initial = savedDefault;
          }
          if (!initial) {
            const cfg = config?.model?.trim();
            if (cfg) {
              const slash = cfg.indexOf("/");
              if (slash > 0) {
                const value = `${cfg.slice(0, slash)}::${cfg.slice(slash + 1)}`;
                if (options.some((o) => o.value === value)) initial = value;
              }
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
          const models: Record<string, { providerID: string; modelID: string }> = {};
          for (const a of agentsData) {
            if (a.name && a.model?.providerID && a.model?.modelID) {
              models[a.name] = { providerID: a.model.providerID, modelID: a.model.modelID };
            }
          }
          setAgentModels(models);
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
    const sequence = ++refreshSequenceRef.current;
    const requestedTaskId = taskId;
    try {
      const data = await getJson<{ task: TaskSummary }>(`/api/tasks/${taskId}`);
      if (
        sequence !== refreshSequenceRef.current ||
        taskIdRef.current !== requestedTaskId
      ) {
        return;
      }
      taskRef.current = data.task;
      setTask(data.task);
      setLoadError(null);
    } catch (err) {
      if (
        sequence !== refreshSequenceRef.current ||
        taskIdRef.current !== requestedTaskId
      ) {
        return;
      }
      if (taskRef.current?.id === requestedTaskId) return;
      setLoadError(err instanceof Error ? err.message : "タスクを読み込めません");
    }
  }, [taskId]);

  const closeSessionDialog = useCallback(() => {
    setSessionDialogOpen(false);
    window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="メニューを開く"]')
        ?.focus();
    }, 0);
  }, []);

  const handleSessionSwitch = useCallback(async () => {
    await refreshTask();
    closeSessionDialog();
  }, [refreshTask, closeSessionDialog]);

  useEffect(() => {
    void refreshTask();
  }, [refreshTask]);

  const streamStatusType = stream.status?.type;
  const streamActive =
    streamStatusType === "busy" || streamStatusType === "retry";
  const hasActiveTask =
    streamActive || (streamStatusType === undefined && task?.status === "working");
  // Block composer while the task is known-busy even before stream.status loads.
  const working = hasActiveTask;
  const [sending, setSending] = useState(false);
  const composerLocked = working || sending;
  const voiceDisabled = composerLocked || !task?.sessionId;
  const voice = useVoiceInput({ disabled: voiceDisabled });
  useEffect(() => {
    const onVisibilityChange = () => {
      const visible = document.visibilityState === "visible";
      setPageVisible(visible);
      if (visible && hasActiveTask) void refreshTask();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [hasActiveTask, refreshTask]);

  useEffect(() => {
    if (!pageVisible || !hasActiveTask) return;
    const poll = setInterval(() => void refreshTask(), ACTIVE_TASK_POLL_MS);
    return () => clearInterval(poll);
  }, [hasActiveTask, pageVisible, refreshTask]);

  // busy → idle transition: refresh diff + task stats + full message resync
  const prevStatusRef = useRef<string | null | undefined>(null);
  const streamScopeKey = `${task?.directory ?? ""}\u0000${task?.sessionId ?? ""}`;
  const prevStreamScopeKeyRef = useRef(streamScopeKey);
  const refreshTodos = stream.refreshTodos;
  const resync = stream.resync;
  useEffect(() => {
    if (prevStreamScopeKeyRef.current !== streamScopeKey) {
      prevStreamScopeKeyRef.current = streamScopeKey;
      prevStatusRef.current = streamStatusType ?? null;
      return;
    }
    const cur = streamStatusType;
    const wasBusy =
      prevStatusRef.current === "busy" || prevStatusRef.current === "retry";
    // Only treat explicit idle — null is the post-reset placeholder, not idle.
    const nowIdle = cur === "idle";
    if (wasBusy && nowIdle) {
      setDiffKey((k) => k + 1);
      void refreshTask();
      // The engine sometimes omits the final `todo.updated` SSE event when a
      // session transitions to idle, leaving the plan badge stuck on "進行中".
      // Reconcile the todo list from the server here.
      void refreshTodos();
      // R3 skips message init while busy; reconcile the final REST snapshot now.
      void resync();
    }
    prevStatusRef.current = cur;
  }, [refreshTask, refreshTodos, resync, streamScopeKey, streamStatusType]);

  const prevNotifiedStatusRef = useRef<string | null | undefined>(null);
  useEffect(() => {
    if (
      streamStatusType !== null &&
      streamStatusType !== undefined &&
      prevNotifiedStatusRef.current !== streamStatusType
    ) {
      notifyTasksChanged();
    }
    prevNotifiedStatusRef.current = streamStatusType;
  }, [streamStatusType]);

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

  // Auto-stick scroll to bottom. We intentionally avoid rAF timeouts because
  // mobile Safari can ignore scrollTo during inertial scrolling; re-running
  // the effect when the stream changes keeps the conversation pinned without
  // fighting the user when they manually scroll up.
  useEffect(() => {
    if (!stickRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [
    stream.messages,
    stream.permissions,
    stream.questions,
    stream.status,
  ]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
  }, []);

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

  // Context window usage, derived from the most recent assistant turn's
  // token usage against that model's known context limit (see
  // computeContextUsage for why this uses the last turn, not a sum).
  const contextUsage = useMemo(
    () => computeContextUsage(stream.messages, providerModelsMap),
    [stream.messages, providerModelsMap],
  );

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

  const touchActivity = useCallback(async () => {
    const current = taskRef.current;
    if (!current?.sessionId) return;
    try {
      // Activity ordering is best-effort; never block sending for more than 5s.
      await Promise.race([
        sendJson("POST", `/api/tasks/${current.id}/activity`, {
          sessionId: current.sessionId,
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch {
      // Activity ordering is best-effort and must not block the prompt.
    }
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || composerLocked) return;
    // Block sending images to a model that cannot accept them. The effective
    // model (agent's configured model when an agent is selected, otherwise the
    // manual selector) is the one that actually serves the prompt, so check
    // image support against it — not the manual selector that may be ignored.
    const sendingModelKey = (() => {
      const am = agent ? agentModels[agent] : undefined;
      if (am) return `${am.providerID}::${am.modelID}`;
      return model || ``;
    })();
    const hasImage = attachments.some((a) => IMAGE_MIME_RE.test(a.mime));
    const sendingImageSupported = sendingModelKey
      ? modelCapabilities[sendingModelKey]?.image === true ||
        modelCapabilities[sendingModelKey]?.attachment === true
      : false;
    const sendingImageBlocked = hasImage && !sendingImageSupported;
    if (sendingImageBlocked) {
      setSendError(
        "選択中のエージェント/モデルは画像入力に対応していないか、画像対応を確認できません。画像を削除するか、画像対応モデルを選んでください。",
      );
      return;
    }
    const files = attachments.map((a) => ({
      uri: a.uri,
      mime: a.mime,
      ...(a.name ? { name: a.name } : {}),
    }));
    setInput("");
    setAttachments([]);
    setSendError(null);
    setSending(true);
    stickRef.current = true;
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    try {
      await touchActivity();
      const [providerID, modelID] = model ? model.split("::") : [];
      const opts = {
        ...(agent ? { agent } : {}),
        ...(providerID && modelID ? { model: { providerID, modelID } } : {}),
        ...(files.length > 0 ? { files } : {}),
        ...(intelligence ? { variant: intelligence } : {}),
      };
      const parsed = parseCommandSubmit(text, slashCommands);
      if (parsed) {
        await stream.sendCommand(parsed.command, parsed.arguments, opts);
      } else {
        await stream.sendPrompt(text, opts);
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "送信に失敗しました");
      setInput(text);
      setAttachments(attachments);
    } finally {
      setSending(false);
      notifyTasksChanged();
    }
  }, [
    input,
    attachments,
    composerLocked,
    stream,
    model,
    agent,
    agentModels,
    modelCapabilities,
    intelligence,
    slashCommands,
    touchActivity,
  ]);

  const syncCursor = useCallback(() => {
    const el = textareaRef.current;
    if (el) setCursor(el.selectionStart ?? 0);
  }, []);

  const applySlash = useCallback(
    (name: string) => {
      const query = parseSlashQuery(input, cursor);
      if (!query) return;
      const next = applySlashCompletion(input, query, name);
      setInput(next.text);
      setCursor(next.cursor);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(next.cursor, next.cursor);
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
      });
    },
    [input, cursor],
  );

  // Resolve the model that will actually serve the prompt: the selected
  // agent's configured model takes priority over the manual model selector.
  const effectiveModelKey = (() => {
    const am = agent ? agentModels[agent] : undefined;
    if (am) return `${am.providerID}::${am.modelID}`;
    return model || ``;
  })();
  const imageSupported = effectiveModelKey
    ? modelCapabilities[effectiveModelKey]?.image === true ||
      modelCapabilities[effectiveModelKey]?.attachment === true
    : false;
  const hasImageAttachment = attachments.some((a) => IMAGE_MIME_RE.test(a.mime));
  const showImageWarning = hasImageAttachment && !imageSupported;

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ``));
      reader.onerror = () => reject(reader.error ?? new Error(`read failed`));
      reader.readAsDataURL(file);
    });

  const addImageFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => IMAGE_MIME_RE.test(f.type));
    const next: Attachment[] = [];
    for (const f of list) {
      try {
        const uri = await readFileAsDataUrl(f);
        next.push({ uri, mime: f.type, name: f.name, preview: uri });
      } catch {
        /* skip unreadable file */
      }
    }
    if (next.length > 0) {
      setAttachments((cur) => [...cur, ...next]);
      stickRef.current = true;
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((cur) => cur.filter((_, i) => i !== index));
  }, []);

  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === `file` && IMAGE_MIME_RE.test(it.type)) {
          const f = it.getAsFile();
          if (f) imageFiles.push(f);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        void addImageFiles(imageFiles);
      }
    },
    [addImageFiles],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      void addImageFiles(e.dataTransfer.files);
    },
    [addImageFiles],
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer?.types?.includes(`Files`)) e.preventDefault();
  }, []);

  const approvePlan = useCallback(async () => {
    if (working) throw new Error(`セッションの完了を待ってください`);
    setSendError(null);
    setAgent(`build`);
    stickRef.current = true;
    try {
      await touchActivity();
      await stream.sendPrompt(PLAN_APPROVAL_PROMPT, { agent: `build` });
    } finally {
      notifyTasksChanged();
    }
  }, [working, stream, touchActivity]);

  const intelligenceVariants = useMemo(() => {
    if (!model) return [];
    const modelMeta = providerModelsMap[model];
    if (!modelMeta) return [];
    return getIntelligenceVariants(modelMeta);
  }, [model, providerModelsMap]);
  // Prefer last assistant message's model once stream is loaded.
  // Seeding runs at most once per session scope: once a model is resolved
  // (either from a prior assistant message or from a user's manual choice),
  // later assistant turns must NOT clobber the user-selected model /
  // intelligence. Without this guard, the first assistant reply on a new
  // session resets a user-selected intelligence back to デフォルト, making
  // the intelligence selector appear "stuck" / unchangeable.
  const seededModelRef = useRef(false);
  useEffect(() => {
    seededModelRef.current = false;
  }, [streamScopeKey]);
  useEffect(() => {
    if (seededModelRef.current || !stream.loaded || modelOptions.length === 0) return;
    for (let i = stream.messages.length - 1; i >= 0; i--) {
      const info = stream.messages[i]?.info;
      if (info?.role !== "assistant" || !info.providerID || !info.modelID) continue;
      const value = `${info.providerID}::${info.modelID}`;
      if (modelOptions.some((o) => o.value === value)) {
        // Only swap the model when it actually differs from the current
        // selection. Resetting intelligence when the model is unchanged
        // would discard a user-selected variant on the first assistant
        // reply of a new session (the "cannot change intelligence" bug).
        if (value !== model) {
          setModel(value);
          setIntelligence("");
        }
        seededModelRef.current = true;
      }
      break;
    }
  }, [stream.loaded, stream.messages, modelOptions, model]);

  useEffect(() => {
    autoReplyIdsRef.current.clear();
    setAutoReplyFailedIds(new Set());
  }, [streamScopeKey]);

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
    const base = task?.title ? `${task.title} · OpenCodeWebUI` : "OpenCodeWebUI";
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
      document.title = "OpenCodeWebUI";
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

  const onVoiceTranscript = useCallback(
    (text: string) => {
      if (text) {
        setInput((prev) => {
          const suffix = prev && !/\s$/.test(prev) ? " " : "";
          return prev + suffix + text;
        });
      }
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
      });
    },
    [],
  );

  // Session-level actions (compact / revert / unrevert) shared between the
  // Zone A compact button and the Zone C kebab menu. The hook keeps a single
  // busy flag so the three operations disable each other while one is running,
  // matching the previous SessionActions behavior.
  const sessionActions = useSessionActions(
    task?.sessionId
      ? {
          directory: task.directory,
          sessionId: task.sessionId,
          lastUserMessageId: lastRevertMessageId,
          messages: stream.visibleMessages,
          onRestoreText: restoreToComposer,
          onDone: () => {
            void stream.resync();
            setDiffKey((k) => k + 1);
          },
        }
      : {
          directory: task?.directory ?? "",
          sessionId: "",
          lastUserMessageId: null,
          messages: stream.visibleMessages,
          onRestoreText: restoreToComposer,
          onDone: () => {
            void stream.resync();
            setDiffKey((k) => k + 1);
          },
        },
  );

  // Zone C data: kebab groups. Stop and compact stay in Zone A; files/graph/
  // diff stay in Zone B at lg, while task, session, panels, and danger actions
  // are available from the kebab.
  const headerKebabGroups = useMemo<KebabGroup[]>(() => {
    const hasSession = !!task?.sessionId;
    const sessionItems: KebabItem[] = [
      {
        id: "revert",
        label: "巻き戻す (undo)",
        icon: <RotateCcw className="h-4 w-4" />,
        onSelect: sessionActions.revert,
        disabled: !hasSession || !lastRevertMessageId || sessionActions.busy !== null,
        busy: sessionActions.busy === "revert",
      },
      {
        id: "unrevert",
        label: "巻き戻しを取消す (redo)",
        icon: <RotateCw className="h-4 w-4" />,
        onSelect: sessionActions.unrevert,
        disabled: !hasSession || sessionActions.busy !== null,
        busy: sessionActions.busy === "unrevert",
      },
    ];

    const taskItems: KebabItem[] = [
      {
        id: "copy-path",
        label: "作業パスをコピー",
        icon: copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />,
        onSelect: () => void copyPath(),
      },
      {
        id: "resync",
        label: "再同期",
        icon: <RefreshCw className="h-4 w-4" />,
        onSelect: () => {
          void stream.resync();
          setDiffKey((key) => key + 1);
        },
        disabled: working,
      },
    ];

    const panelItems: KebabItem[] = [];
    if (!isLg) {
      panelItems.push({
        id: "panel-files",
        label: "ファイルツリー",
        icon: <FolderTree className="h-4 w-4" />,
        active: showDiff && sidePanel === "files",
        onSelect: () => {
          changeShowDiff(true);
          changeTab("diff");
          changeSidePanel("files");
        },
      });
      panelItems.push({
        id: "panel-graph",
        label: "グラフ",
        icon: <GitGraph className="h-4 w-4" />,
        active: showDiff && sidePanel === "graph",
        onSelect: () => {
          changeShowDiff(true);
          changeTab("diff");
          changeSidePanel("graph");
        },
      });
    }
    panelItems.push({
      id: "panel-terminal",
      label: "ターミナル",
      icon: <Terminal className="h-4 w-4" />,
      active: showDiff && sidePanel === "pty",
      onSelect: () => {
        changeShowDiff(true);
        changeTab("diff");
        changeSidePanel("pty");
      },
    });
    if (!isLg) {
      panelItems.push({
        id: "panel-diff",
        label: "Diff パネル",
        icon: <PanelRight className="h-4 w-4" />,
        active: showDiff && sidePanel === "diff",
        onSelect: () => {
          if (sidePanel === "diff" && showDiff && tab === "diff") {
            changeShowDiff(false);
            changeTab("chat");
          } else {
            changeSidePanel("diff");
            changeShowDiff(true);
            changeTab("diff");
          }
        },
      });
    }

    const dangerItems: KebabItem[] = [
      {
        id: "delete",
        label: "タスクを削除",
        icon: <Trash2 className="h-4 w-4" />,
        onSelect: () => void removeTask(),
        danger: true,
      },
    ];

    const groups: KebabGroup[] = [];
    if (sessionItems.length) {
      groups.push({ id: "session", label: "セッション操作", items: sessionItems });
    }
    groups.push({ id: "task", label: "タスク操作", items: taskItems });
    if (task?.sessionId) {
      groups.push({
        id: "session-switcher",
        label: "セッション切替",
        items: [
          {
            id: "open-session-switcher",
            label: "セッションを切り替え・追加",
            icon: <Layers className="h-4 w-4" />,
            onSelect: () => setSessionDialogOpen(true),
          },
        ],
      });
    }
    if (panelItems.length) {
      groups.push({ id: "panels", label: "パネル切替", items: panelItems });
    }
    groups.push({ id: "danger", label: "危険操作", items: dangerItems });
    return groups;
  }, [
    task?.sessionId,
    copied,
    copyPath,
    working,
    stream,
    sessionActions.busy,
    sessionActions.revert,
    sessionActions.unrevert,
    lastRevertMessageId,
    isLg,
    showDiff,
    sidePanel,
    tab,
    changeShowDiff,
    changeTab,
    changeSidePanel,
    removeTask,
  ]);

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
      changeShowDiff(true);
      changeTab("diff");
      changeSidePanel("diff");
    },
    [task?.directory, changeShowDiff, changeTab, changeSidePanel],
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
  }, [task?.directory, task?.sessionId, setActiveScope]);

  // Clear only on TaskView unmount — not on every session switch cleanup.
  useEffect(() => {
    return () => setActiveScope(null);
  }, [setActiveScope]);

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

  const siblingTaskCallIds = useMemo(
    () => collectTaskCallIds(stream.visibleMessages),
    [stream.visibleMessages],
  );

  const planPaths = useMemo(
    () =>
      new Map(
        stream.visibleMessages.flatMap((message) => {
          const path = extractPlanMarkdownPath(message);
          return path ? [[message.info.id, path] as const] : [];
        }),
      ),
    [stream.visibleMessages],
  );
  const actionablePlanMessageId = Array.from(planPaths.keys()).at(-1) ?? null;
  const approvedPlanIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of planPaths.keys()) {
      if (isPlanApproved(stream.visibleMessages, id)) ids.add(id);
    }
    return ids;
  }, [planPaths, stream.visibleMessages]);

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
              <span className="text-xs text-warning">再接続中…</span>
            )}
            {stream.connection === "down" && (
              <span className="text-xs text-danger">切断（再試行中）</span>
            )}
          </div>
          {(task.branch || (task.cost ?? 0) > 0 || contextUsage) && (
            <div className="mt-0.5 hidden items-center gap-1 text-xs text-faint sm:flex">
              {task.branch && (
                <>
                  <GitBranch className="h-3 w-3" />
                  <span className="truncate font-mono">{task.branch}</span>
                  <span className="mx-1">·</span>
                </>
              )}
              <span className="truncate">{task.projectName}</span>
              {contextUsage && (
                <>
                  <span className="mx-1">·</span>
                  <span
                    className="flex shrink-0 items-center gap-1.5"
                    title={`コンテキスト使用量: ${formatTokens(contextUsage.used)} / ${formatTokens(contextUsage.limit)}トークン（${contextUsage.pct}%）`}
                  >
                    <span className="h-1.5 w-10 overflow-hidden rounded-full bg-surface-2">
                      <span
                        className={cx(
                          "block h-full rounded-full",
                          contextUsage.pct >= 90
                            ? "bg-danger"
                            : contextUsage.pct >= 70
                              ? "bg-warning"
                              : "bg-accent",
                        )}
                        style={{ width: `${contextUsage.pct}%` }}
                      />
                    </span>
                    <span className="font-mono">
                      {formatTokens(contextUsage.used)}/
                      {formatTokens(contextUsage.limit)} ({contextUsage.pct}%)
                    </span>
                  </span>
                </>
              )}
              {(task.cost ?? 0) > 0 && (
                <>
                  <span className="mx-1">·</span>
                  <span
                    className="shrink-0"
                    title="このセッションの累計コスト"
                  >
                    累計 {formatCostValue(task.cost!, costPrefs)}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        {/* Right toolbar: outer wrapper (overflow visible) keeps the kebab
            popup from being clipped. Inner scroll container holds only
            Zone A / Zone B so horizontal scroll is limited to those ops. */}
        <div className="flex min-w-0 shrink-0 items-center gap-0.5 sm:gap-1">
          <div className="flex max-w-[60vw] items-center gap-0.5 overflow-x-auto sm:max-w-none sm:overflow-visible [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Zone A: always visible across all breakpoints: stop and compact. */}
          {working && (
            <Button variant="danger" size="sm" onClick={() => void stream.abort()}>
              <Square className="h-3 w-3 fill-current" />
              <span className="hidden sm:inline">停止</span>
            </Button>
          )}
          {task.sessionId && (
            <>
              <CompactButton
                busy={sessionActions.busy === "compact"}
                disabled={sessionActions.busy !== null}
                onClick={sessionActions.compact}
              />
            </>
          )}

          {/* Zone B: panel toggles shown directly at their breakpoint and
              demoted into the kebab menu (Zone C) below it. Thresholds:
              file tree / graph / diff at lg (1024px); terminal stays in Zone C.
              Rendered conditionally on isLg/isMd (not CSS `hidden lg:...`)
              because those utility classes lost the display-property
              cascade to the always-on `inline-flex` base class on Button,
              leaving the buttons visible below their breakpoint. JS-driven
              rendering also keeps this in sync with the kebab's group-2
              conditional so a control never appears in both places. */}
          {isLg && (
            <Button
              variant="ghost"
              size="icon"
              title="ファイルツリー"
              className={cx(
                showDiff && sidePanel === "files" && "bg-surface-2 text-text",
              )}
              onClick={() => {
                changeShowDiff(true);
                changeTab("diff");
                changeSidePanel("files");
              }}
            >
              <FolderTree className="h-4 w-4" />
            </Button>
          )}
          {isLg && (
            <Button
              variant="ghost"
              size="icon"
              title="グラフ"
              className={cx(
                showDiff && sidePanel === "graph" && "bg-surface-2 text-text",
              )}
              onClick={() => {
                changeShowDiff(true);
                changeTab("diff");
                changeSidePanel("graph");
              }}
            >
              <GitGraph className="h-4 w-4" />
            </Button>
          )}
          {isLg && (
            <Button
              variant="ghost"
              size="icon"
              title="Diff パネル"
              className={cx(
                showDiff && sidePanel === "diff" && "bg-surface-2 text-text",
              )}
              onClick={() => {
                if (sidePanel === "diff" && showDiff && tab === "diff") {
                  changeShowDiff(false);
                  changeTab("chat");
                } else {
                  changeSidePanel("diff");
                  changeShowDiff(true);
                  changeTab("diff");
                }
              }}
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          )}

          </div>
          {/* Zone C: session, task, session-switcher, panels, and danger. */}
          <HeaderKebabMenu
            groups={headerKebabGroups}
            triggerLabel="メニューを開く"
          />
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
                changeTab(t.key);
                if (t.panel) {
                  changeSidePanel(t.panel);
                  changeShowDiff(true);
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
                {!stream.loaded && stream.messages.length === 0 && (
                  <div className="flex justify-center py-10">
                    <Spinner />
                  </div>
                )}
                {timeline.map((m) => {
                  const messageTime =
                    m.info.time?.completed ?? m.info.time?.created ?? null;
                  return (
                  <div key={m.info.id} className="group/msg flex flex-col gap-2">
                    <div
                      className={cx(
                        "flex items-center gap-1.5 text-[10px] text-faint",
                        m.info.role === "user" ? "justify-end" : "justify-start",
                      )}
                    >
                      {m.info.role === "assistant" ? (
                        <MessageMetaHeader
                          info={m.info}
                          modelLabel={
                            m.info.providerID && m.info.modelID
                              ? modelLabels[`${m.info.providerID}::${m.info.modelID}`]
                              : undefined
                          }
                          costPrefs={costPrefs}
                        />
                      ) : (
                        messageTime && <span>{formatMessageTime(messageTime)}</span>
                      )}
                    </div>
                    {m.parts
                      .filter((p) => {
                        const planPath = planPaths.get(m.info.id);
                        if (!planPath) return true;
                        return (
                          normalizedPlanPath(p.text) !== planPath &&
                          normalizedPlanPath(p.filename) !== planPath
                        );
                      })
                      .map((p) => (
                      <PartView
                        key={p.id}
                        part={p}
                        role={m.info.role}
                        onFileClick={openFileInDiff}
                        directory={task.directory}
                        rootSessionId={task.sessionId}
                        siblingTaskCallIds={siblingTaskCallIds}
                        modelLabels={modelLabels}
                        costPrefs={costPrefs}
                      />
                    ))}
                    {planPaths.get(m.info.id) && (
                      <PlanDocumentCard
                        path={planPaths.get(m.info.id)!}
                        directory={task.directory}
                        actionable={m.info.id === actionablePlanMessageId}
                        working={working}
                        approved={approvedPlanIds.has(m.info.id)}
                        initialCollapsed={!isMd}
                        onApprove={approvePlan}
                      />
                    )}
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
                    {m.info.error?.data?.message && (
                      <p className="break-all rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger">
                        {m.info.error.data.message}
                      </p>
                    )}
                  </div>
                );
                })}
                {(accessMode === "ask"
                  ? stream.permissions
                  : stream.permissions.filter((p) => autoReplyFailedIds.has(p.id))
                ).map((p) => (
                  <PermissionCard
                    key={p.id}
                    request={p}
                    onReply={onReplyPermission}
                    onEnableFullAccess={() => changeAccessMode("full")}
                  />
                ))}
                {accessMode === "full" &&
                  stream.permissions.some((p) => !autoReplyFailedIds.has(p.id)) && (
                  <p className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning">
                    フルアクセス: 権限要求を自動承認中…
                  </p>
                )}
                {accessMode === "full" && autoReplyFailedIds.size > 0 && (
                  <p className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger">
                    自動承認に失敗した権限があります。下のカードから手動で応答してください。
                  </p>
                )}
                {stream.questions.map((q) => (
                  <QuestionCard
                    key={q.id}
                    request={q}
                    onReply={onReplyQuestion}
                    onReject={onRejectQuestion}
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
              {showImageWarning && (
                <p
                  role="alert"
                  className="mt-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-1.5 text-xs text-warning"
                >
                  選択中のエージェント/モデルは画像入力に対応していない可能性があります。画像が反映されない場合があります。
                </p>
              )}
              <div
                onDrop={onDrop}
                onDragOver={onDragOver}
                className="relative mt-2 rounded-2xl border border-border bg-bg px-3 py-2 focus-within:border-border-strong focus-within:ring-2 focus-within:ring-primary/20"
              >
                {slashOpen && (
                  <SlashSuggestMenu
                    items={slashItems}
                    activeIndex={slashIndex}
                    onHover={setSlashIndex}
                    onSelect={(cmd) => applySlash(cmd.name)}
                  />
                )}
                {attachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {attachments.map((a, i) => (
                      <div
                        key={`${a.name ?? a.uri}-${i}`}
                        className="group relative h-14 w-14 overflow-hidden rounded-lg border border-border bg-surface"
                      >
                        {a.preview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={a.preview}
                            alt={a.name ?? "添付画像"}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-faint">
                            <Paperclip className="h-4 w-4" />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeAttachment(i)}
                          aria-label="添付を削除"
                          className="absolute right-0.5 top-0.5 rounded-full bg-bg/80 p-0.5 text-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 max-sm:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={input}
                  rows={1}
                  style={{ fontSize: "16px", textSizeAdjust: "100%", WebkitTextSizeAdjust: "100%" }}
                  aria-label="フォローアップを送信"
                  role="combobox"
                  aria-busy={composerLocked || undefined}
                  aria-controls={slashOpen ? "slash-suggest-listbox" : undefined}
                  disabled={!task.sessionId}
                  readOnly={composerLocked}
                  aria-autocomplete="list"
                  aria-expanded={slashOpen}
                  aria-activedescendant={
                    slashOpen && slashItems[slashIndex]
                      ? `slash-cmd-${slashItems[slashIndex].name}`
                      : undefined
                  }
                  onChange={(e) => {
                    setInput(e.target.value);
                    setCursor(e.target.selectionStart ?? e.target.value.length);
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                  }}
                  onClick={syncCursor}
                  onKeyUp={syncCursor}
                  onSelect={syncCursor}
                  onPaste={onPaste}
                  onCompositionStart={() => (composingRef.current = true)}
                  onCompositionEnd={() => (composingRef.current = false)}
                  onKeyDown={(e) => {
                    if (slashOpen && !composingRef.current) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setSlashIndex((i) => (i + 1) % slashItems.length);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setSlashIndex(
                          (i) =>
                            (i - 1 + slashItems.length) % slashItems.length,
                        );
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        const item = slashItems[slashIndex];
                        if (item) applySlash(item.name);
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setSlashDismissed(true);
                        return;
                      }
                    }
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !composerLocked &&
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
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) void addImageFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!task.sessionId || working}
                      aria-label="画像を添付"
                      title="画像を添付"
                      className="flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-muted transition-colors hover:bg-accent hover:text-fg disabled:opacity-40"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                    </button>
                    <VoiceInputButton voice={voice} onTranscript={onVoiceTranscript} disabled={voiceDisabled} />
                    {modelOptions.length > 0 && (
                      <GhostSelect
                        value={model}
                        onChange={(e) => {
                          setModel(e.target.value);
                          setIntelligence("");
                          // The user explicitly picked a model; suppress the
                          // auto-seed effect so later assistant turns can't
                          // reset the model/intelligence back to defaults.
                          seededModelRef.current = true;
                        }}
                        disabled={!task.sessionId}
                        aria-label="モデル"
                        icon={<ModelSelectIcon model={model} />}
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
                    {intelligenceVariants.length > 0 && (
                      <IntelligenceSelect
                        variants={intelligenceVariants}
                        value={intelligence}
                        onChange={(v) =>
                          setIntelligence(isIntelligenceVariant(v) ? v : "")
                        }
                        disabled={!task.sessionId}
                      />
                    )}
                    {agents.length > 0 && (
                      <GhostSelect
                        value={agent}
                        onChange={(e) => setAgent(e.target.value)}
                        disabled={!task.sessionId}
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
                    <AccessModeSelect
                      value={accessMode}
                      onChange={changeAccessMode}
                      disabled={!task.sessionId}
                      className="h-8 shrink-0"
                    />
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
                      disabled={
                        (!input.trim() && attachments.length === 0) ||
                        !task.sessionId
                      }
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
              <GraphPanel
                directory={task.directory}
                refreshKey={diffKey}
                working={working}
              />
            </div>
          )}
          {sidePanel === "pty" && (
            <div className="flex min-h-0 w-full flex-1">
              <PtyPanel directory={task.directory} />
            </div>
          )}
        </div>
      </div>
      {sessionDialogOpen && task.sessionId && (
        <SessionSwitcherDialog
          workspaceId={task.id}
          directory={task.directory}
          currentSessionId={task.sessionId}
          onSwitch={handleSessionSwitch}
          onClose={closeSessionDialog}
        />
      )}
    </div>
  );
}
