"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  FolderTree,
  GitBranch,
  GitGraph,
  Layers,
  ListTodo,
  Loader2,
  PanelRight,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Shrink,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { AccessModeSelect } from "@/components/AccessModeSelect";
import { Composer, type ComposerAttachment } from "@/components/Composer";
import { GoalLoopOptions, GoalLoopToggle } from "@/components/GoalLoopComposer";
import { AutoOptimizeSelect } from "@/components/AutoOptimizeSelect";
import { IntelligenceSelect } from "@/components/IntelligenceSelect";
import { ModelSelect } from "@/components/ModelSelect";
import { SkillPermissionSelect } from "@/components/SkillPermissionSelect";
import { SubagentPermissionSelect } from "@/components/SubagentPermissionSelect";
import { StatusBadge } from "@/components/StatusBadge";
import { notifyTasksChanged } from "@/lib/events";
import { setActiveSessionAttention } from "@/lib/active-session-attention";
import {
  useShellExtras,
  useShellSetActiveScope,
} from "@/components/shell/ShellContext";
import { useOptionalGlobalAttention } from "@/components/shell/GlobalAttentionProvider";
import { MobileMenuHeader } from "@/components/shell/MobileMenuHeader";
import { useMobileScrollTarget } from "@/components/shell/MobileScrollTargetContext";
import { MobileMenuButton } from "@/components/shell/MobileMenuButton";
import { AttentionBadge } from "@/components/shell/AttentionBadge";
import { Button, GhostSelect, Spinner, cx, formatMessageTime } from "@/components/ui";
import {
  readAccessMode,
  writeAccessMode,
  type AccessMode,
} from "@/lib/access-mode";
import {
  permissionAutoAction,
  readSubagentPermission,
  writeSubagentPermission,
  SUBAGENT_PERMISSION_EVENT,
  type SubagentPermission,
} from "@/lib/subagent-permission";
import {
  readSkillPermission,
  writeSkillPermission,
  SKILL_PERMISSION_EVENT,
  type SkillPermission,
} from "@/lib/skill-permission";
import {
  DEFAULT_MODEL_EVENT,
  readDefaultModel,
  readDefaultModelFromServer,
  writeDefaultModel,
  writeLastUsedModel,
} from "@/lib/default-model";
import { formatTokens } from "@addons/codexbar";
import { readCodexBarAutoUsage } from "@/lib/codexbar-auto";
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
import {
  AUTO_MODEL_OPTION,
  AUTO_MODEL_VALUE,
  chooseAutoModel,
  classifyPrompt,
  type AutoCandidateProvider,
  type AutoDecision,
  type AutoOptimizeMode,
} from "@/lib/auto-model";
import {
  AUTO_OPTIMIZE_EVENT,
  AUTO_OPTIMIZE_SETTING_KEY,
  AUTO_SHOW_MODEL_EVENT,
  readAutoOptimizeMode,
  readAutoShowModel,
  writeAutoOptimizeMode,
  writeAutoSettingToServer,
} from "@/lib/auto-settings";
import {
  readAutoTaskRecord,
  writeAutoTaskRecord,
  type AutoTaskRecord,
} from "@/lib/auto-task-record";
import { copyText } from "@/lib/clipboard";
import { formatCostValue, useCostDisplayPrefs } from "@/lib/currency";
import { applyFaviconBadge } from "@/lib/favicon-badge";
import {
  readSideWidthFromServer,
  writeSideWidthToServer,
} from "@/lib/sidepanel-settings";
import {
  filterEnabledModelOptions,
  formatModelLabel,
  modelOrderPreferenceFromProviders,
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
import { playSessionCompleteSound } from "@/lib/session-complete-sound";
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
import type { GoalLoopDto } from "@/lib/goal-loop";
import type { TaskSummary, Todo } from "@/lib/types";
import type { ProviderModelsDto } from "@/lib/extensions";
import { DiffPane } from "./DiffPane";
import { FileTreePanel } from "./FileTreePanel";
import { GoalLoopPanel } from "./GoalLoopPanel";
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
import { NextAction } from "./NextAction";
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
  connected?: string[];
  default: Record<string, string>;
};

type AgentResponse = {
  name: string;
  mode?: string;
  hidden?: boolean;
  model?: { modelID: string; providerID: string };
}[];

type Attachment = ComposerAttachment;

type ComposerDraft = { input: string; attachments: Attachment[] };

const TASK_CACHE_MAX = 24;
const COMPOSER_DRAFT_CACHE_MAX = 48;

/** Shown when Auto finds no connected + enabled candidate (addendum spec §4). */
const AUTO_NO_CANDIDATE_ERROR =
  "Auto で選択可能なモデルがありません。プロバイダ接続とモデル有効化を確認してください。";

/** Banner text for a resolved Auto selection (initial chip and follow-up). */
function formatAutoDecisionNotice(decision: AutoDecision): string {
  return `Auto: ${decision.providerID}/${decision.modelID}${
    decision.variant ? ` · effort ${decision.variant}` : ""
  } — ${decision.reason}`;
}
const taskSummaryCache = new Map<string, TaskSummary>();
const composerDraftCache = new Map<string, ComposerDraft>();

function rememberTaskSummary(task: TaskSummary) {
  taskSummaryCache.delete(task.id);
  taskSummaryCache.set(task.id, task);
  while (taskSummaryCache.size > TASK_CACHE_MAX) {
    const oldest = taskSummaryCache.keys().next().value;
    if (typeof oldest !== "string") break;
    taskSummaryCache.delete(oldest);
  }
}

function readCachedTaskSummary(taskId: string): TaskSummary | null {
  const cached = taskSummaryCache.get(taskId);
  if (!cached) return null;
  taskSummaryCache.delete(taskId);
  taskSummaryCache.set(taskId, cached);
  return cached;
}

function rememberComposerDraft(scopeKey: string, draft: ComposerDraft) {
  if (!scopeKey) return;
  composerDraftCache.delete(scopeKey);
  composerDraftCache.set(scopeKey, draft);
  while (composerDraftCache.size > COMPOSER_DRAFT_CACHE_MAX) {
    const oldest = composerDraftCache.keys().next().value;
    if (typeof oldest !== "string") break;
    composerDraftCache.delete(oldest);
  }
}

function readComposerDraft(scopeKey: string): ComposerDraft | undefined {
  const draft = composerDraftCache.get(scopeKey);
  if (!draft) return undefined;
  composerDraftCache.delete(scopeKey);
  composerDraftCache.set(scopeKey, draft);
  return draft;
}

export function __clearTaskViewCachesForTest() {
  taskSummaryCache.clear();
  composerDraftCache.clear();
}

const IMAGE_MIME_RE = /^image\//i;
// Match POST /api/tasks R28 limits so follow-up attachments cannot bypass them.
const MAX_IMAGE_COUNT = 10;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function estimateDataUrlBytes(uri: string): number {
  const comma = uri.indexOf(",");
  if (comma < 0) return Number.POSITIVE_INFINITY;
  const b64 = uri.slice(comma + 1);
  return Math.floor((b64.length * 3) / 4);
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
        aria-expanded={open}
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
  const [task, setTask] = useState<TaskSummary | null>(() =>
    readCachedTaskSummary(taskId),
  );
  const [goalLoop, setGoalLoop] = useState<GoalLoopDto | null>(null);
  /**
   * Composer-level Goal loop switch. The composer textarea carries the goal
   * text (same as the top page), so there is no separate goal field and the
   * form costs zero vertical space while OFF.
   */
  const [goalLoopEnabled, setGoalLoopEnabled] = useState(false);
  const [goalLoopAcceptance, setGoalLoopAcceptance] = useState("");
  const [goalLoopMaxTurns, setGoalLoopMaxTurns] = useState(10);
  const [goalLoopBusy, setGoalLoopBusy] = useState(false);
  const [goalLoopError, setGoalLoopError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const taskRef = useRef<TaskSummary | null>(null);
  const taskIdRef = useRef(taskId);
  const refreshSequenceRef = useRef(0);
  if (taskIdRef.current !== taskId) {
    taskIdRef.current = taskId;
    taskRef.current = readCachedTaskSummary(taskId);
  }

  useEffect(() => {
    const cached = readCachedTaskSummary(taskId);
    taskRef.current = cached;
    setTask(cached);
    setLoadError(null);
  }, [taskId]);
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
  const inputRef = useRef(input);
  const attachmentsRef = useRef(attachments);
  const composerScopeRef = useRef("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [intelligence, setIntelligence] = useState<IntelligenceVariant | "">("");
  const [providerModelsMap, setProviderModelsMap] = useState<
    Record<string, ProviderModelMeta>
  >({});
  const [accessMode, setAccessMode] = useState<AccessMode>("ask");
  const [subagentPermission, setSubagentPermission] =
    useState<SubagentPermission>("allow");
  const [subagentPermissionSaving, setSubagentPermissionSaving] =
    useState(false);
  const [skillPermission, setSkillPermission] = useState<SkillPermission>("allow");
  const [skillPermissionSaving, setSkillPermissionSaving] = useState(false);
  const [autoRecord, setAutoRecord] = useState<AutoTaskRecord | null>(null);
  const [autoRetryNotice, setAutoRetryNotice] = useState<string | null>(null);
  /** Transient chip for a follow-up Auto resolution (addendum spec §6). */
  const [autoFollowUpNotice, setAutoFollowUpNotice] = useState<string | null>(
    null,
  );
  /**
   * Inputs for the client-side Auto resolution (addendum spec §3). Snapshot
   * of the provider fetch: the *unfiltered* provider list (chooseAutoModel
   * applies the connected filter itself) plus a disabled record derived from
   * the extensions DTO. Null until the fetch succeeds → Auto sends fail with
   * a visible error instead of guessing.
   */
  const [autoInputs, setAutoInputs] = useState<{
    providers: AutoCandidateProvider[];
    connected?: string[];
    disabled: Record<string, true>;
    usage?: import("@/lib/auto-model").AutoProviderUsage;
  } | null>(null);
  /** Auto "Optimize For" policy; shared with HomeView and Settings. */
  const [autoOptimize, setAutoOptimize] = useState<AutoOptimizeMode>(() =>
    readAutoOptimizeMode(),
  );
  /**
   * Whether to name the model Auto picked. Off by default (Cursor parity), so
   * the composer stays quiet unless the user opts in from Settings.
   */
  const [autoShowModel, setAutoShowModel] = useState(() => readAutoShowModel());
  /** Guards the one-shot escalation retry against effect re-entry. */
  const autoRetryFiredRef = useRef(false);
  /** Previous `sessionError`; `undefined` until the first observation. */
  const prevSessionErrorRef = useRef<string | null | undefined>(undefined);
  const costPrefs = useCostDisplayPrefs();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showScrollTopButton, setShowScrollTopButton] = useState(false);
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
  const composerScopeKey = task?.directory && task.sessionId
    ? `${task.directory}\u0000${task.sessionId}`
    : "";

  // Auto selection hand-off from HomeView (tab-scoped sessionStorage). Absent
  // for manual models, for agent-pinned models, and after a tab reload.
  useEffect(() => {
    autoRetryFiredRef.current = false;
    prevSessionErrorRef.current = undefined;
    setAutoRetryNotice(null);
    setAutoFollowUpNotice(null);
    setAutoRecord(readAutoTaskRecord(taskId));
  }, [taskId]);

  const dismissAutoRecord = useCallback(() => {
    setAutoRecord((current) => {
      if (!current) return current;
      const next: AutoTaskRecord = { ...current, dismissed: true };
      // Keep the key itself: it still carries the `retried` guard.
      writeAutoTaskRecord(taskId, next);
      return next;
    });
  }, [taskId]);

  // Follow Auto settings changed in the Settings screen or another tab.
  useEffect(() => {
    const onMode = () => setAutoOptimize(readAutoOptimizeMode());
    const onShow = () => setAutoShowModel(readAutoShowModel());
    window.addEventListener(AUTO_OPTIMIZE_EVENT, onMode);
    window.addEventListener(AUTO_SHOW_MODEL_EVENT, onShow);
    return () => {
      window.removeEventListener(AUTO_OPTIMIZE_EVENT, onMode);
      window.removeEventListener(AUTO_SHOW_MODEL_EVENT, onShow);
    };
  }, []);

  const changeAutoOptimize = useCallback((mode: AutoOptimizeMode) => {
    setAutoOptimize(mode);
    writeAutoOptimizeMode(mode);
    void writeAutoSettingToServer(AUTO_OPTIMIZE_SETTING_KEY, mode);
  }, []);

  /**
   * One banner for all Auto states; follow-up resolutions win.
   *
   * The retry notice is shown regardless of `autoShowModel`: it explains an
   * unexpected extra turn rather than advertising a model name. The selection
   * chip and follow-up notice are suppressed unless the user asked to see
   * which model Auto picked.
   */
  const autoBannerText =
    (autoShowModel ? autoFollowUpNotice : null) ??
    (autoRecord && !autoRecord.dismissed
      ? (autoRetryNotice ??
        (autoShowModel ? formatAutoDecisionNotice(autoRecord.decision) : null))
      : null);

  /** Closes whichever Auto banner is visible, in one click. */
  const dismissAutoBanner = useCallback(() => {
    setAutoFollowUpNotice(null);
    dismissAutoRecord();
  }, [dismissAutoRecord]);

  /**
   * One-shot escalation retry. Fires only on a null → non-null `sessionError`
   * transition for a first prompt that produced no completed assistant text,
   * so follow-up failures and partial successes are never re-sent.
   */
  const { messages: streamMessages, sendPrompt: streamSendPrompt } = stream;
  const streamSessionError = stream.sessionError;

  useEffect(() => {
    const previous = prevSessionErrorRef.current;
    prevSessionErrorRef.current = streamSessionError;
    // First observation is not a transition (e.g. re-opening a failed task).
    if (previous === undefined) return;
    if (previous !== null || streamSessionError === null) return;
    if (autoRetryFiredRef.current) return;
    const record = autoRecord;
    if (!record || record.retried === true) return;
    const prompt = record.prompt;
    const escalation = record.decision.escalation;
    if (!prompt || !escalation) return;
    const sessionId = task?.sessionId;
    if (!sessionId) return;
    const hasCompletedAssistantText = streamMessages.some(
      (message) =>
        message.info.role === "assistant" &&
        message.info.time?.completed !== undefined &&
        message.parts.some(
          (part) => part.type === "text" && (part.text ?? "").trim().length > 0,
        ),
    );
    const userMessageCount = streamMessages.filter(
      (message) => message.info.role === "user",
    ).length;
    if (hasCompletedAssistantText || userMessageCount > 1) return;

    autoRetryFiredRef.current = true;
    const retried: AutoTaskRecord = { ...record, retried: true };
    // Persist *before* sending so a failure or a race still burns the single
    // attempt. When the write itself fails, abort instead of risking a loop.
    if (!writeAutoTaskRecord(taskId, retried)) return;
    setAutoRecord(retried);
    void (async () => {
      try {
        await streamSendPrompt(prompt, {
          model: {
            providerID: escalation.providerID,
            modelID: escalation.modelID,
          },
          ...(escalation.variant ? { variant: escalation.variant } : {}),
          ...(record.agent ? { agent: record.agent } : {}),
          sessionId,
        });
        setAutoRetryNotice(
          `Auto の選択モデルでエラーが発生したため ${escalation.providerID}/${escalation.modelID} で再試行しました`,
        );
      } catch {
        // The composer's existing send-error UI reports the failure.
      }
    })();
  }, [
    streamSessionError,
    streamMessages,
    streamSendPrompt,
    autoRecord,
    task?.sessionId,
    taskId,
  ]);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    if (!composerScopeKey || composerScopeRef.current !== composerScopeKey) {
      return;
    }
    rememberComposerDraft(composerScopeKey, { input, attachments });
  }, [composerScopeKey, input, attachments]);

  useLayoutEffect(() => {
    const prevScope = composerScopeRef.current;
    if (prevScope) {
      rememberComposerDraft(prevScope, {
        input: inputRef.current,
        attachments: attachmentsRef.current,
      });
    }
    composerScopeRef.current = composerScopeKey;
    const draft = composerScopeKey ? readComposerDraft(composerScopeKey) : undefined;
    setInput(draft?.input ?? "");
    setAttachments(draft?.attachments ?? []);
    setCursor(0);
    const raf =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => window.setTimeout(cb, 0);
    raf(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    });
  }, [composerScopeKey]);

  useEffect(() => {
    return () => {
      const scope = composerScopeRef.current;
      if (!scope) return;
      rememberComposerDraft(scope, {
        input: inputRef.current,
        attachments: attachmentsRef.current,
      });
    };
  }, []);

  useEffect(() => {
    // Fast path: hydrate from localStorage so the panel paints without
    // waiting on the network. The DB read below may override this once it
    // resolves (DB wins on conflict), and a localStorage-only value is
    // migrated up to the DB so it survives origin/session changes.
    const localWidth = loadSideWidth();
    setSideWidth(localWidth);
    setTab(readChatTab());
    setShowDiff(readShowDiff());
    setSidePanel(readSidePanel());

    void (async () => {
      const remote = await readSideWidthFromServer();
      if (remote === null) {
        // Nothing in the DB yet — push the localStorage value up so future
        // sessions (other browsers/origins) pick it up.
        void writeSideWidthToServer(localWidth);
        return;
      }
      const next = clampSideWidth(remote);
      setSideWidth(next);
      saveSideWidth(next);
    })();

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
        void writeSideWidthToServer(w);
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

  useEffect(() => {
    setSubagentPermission(readSubagentPermission());
    const onSubagent = (e: Event) => {
      const detail = (e as CustomEvent<SubagentPermission>).detail;
      if (detail === "allow" || detail === "deny") setSubagentPermission(detail);
    };
    window.addEventListener(SUBAGENT_PERMISSION_EVENT, onSubagent);
    return () =>
      window.removeEventListener(SUBAGENT_PERMISSION_EVENT, onSubagent);
  }, []);

  useEffect(() => {
    setSkillPermission(readSkillPermission());
    const onSkill = (e: Event) => {
      const detail = (e as CustomEvent<SkillPermission>).detail;
      if (detail === "allow" || detail === "deny") setSkillPermission(detail);
    };
    window.addEventListener(SKILL_PERMISSION_EVENT, onSkill);
    return () => window.removeEventListener(SKILL_PERMISSION_EVENT, onSkill);
  }, []);

  // DB → localStorage migration so the default model set on another
  // browser/origin is restored here. Non-fatal: when the server is
  // unreachable or has no value, the existing localStorage copy (if any)
  // is left untouched and readDefaultModel() behaves as before.
  useEffect(() => {
    void (async () => {
      const serverValue = await readDefaultModelFromServer().catch(() => null);
      if (serverValue && !readDefaultModel()) {
        writeDefaultModel(serverValue);
      }
    })();
  }, []);

  // Apply localStorage のサブエージェント権限を、タスクを開いた／セッションを
  // 切り替えた／新規セッションを bind したタイミングで OpenCode 側へ同期する。
  // トグル時だけ POST すると、既存セッションや SessionSwitcher 経由の新規作成で
  // UI は「不許可」なのにエンジン側は許可のまま、という穴が残る。
  useEffect(() => {
    if (!task?.id || !task.sessionId) return;
    const permission = readSubagentPermission();
    let cancelled = false;
    void sendJson("POST", "/api/subagent-permission", {
      taskId: task.id,
      sessionId: task.sessionId,
      permission,
    }).catch((err) => {
      if (cancelled) return;
      setSendError(
        err instanceof Error
          ? `サブエージェント権限を同期できませんでした: ${err.message}`
          : "サブエージェント権限を同期できませんでした。",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [task?.id, task?.sessionId]);

  // Apply localStorage のスキル権限を、タスクを開いた／セッションを切り替えた／
  // 新規セッションを bind したタイミングで OpenCode 側へ同期する。
  // トグル時だけ POST すると、既存セッションや SessionSwitcher 経由の新規作成で
  // UI は「不許可」なのにエンジン側は許可のまま、という穴が残る。
  useEffect(() => {
    if (!task?.id || !task.sessionId) return;
    const permission = readSkillPermission();
    let cancelled = false;
    void sendJson("POST", "/api/skill-permission", {
      taskId: task.id,
      sessionId: task.sessionId,
      permission,
    }).catch((err) => {
      if (cancelled) return;
      setSendError(
        err instanceof Error
          ? `スキル権限を同期できませんでした: ${err.message}`
          : "スキル権限を同期できませんでした。",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [task?.id, task?.sessionId]);

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

  const changeSubagentPermission = useCallback(
    async (mode: SubagentPermission) => {
      if (mode === subagentPermission || subagentPermissionSaving || !task?.id) {
        return;
      }
      setSubagentPermissionSaving(true);
      try {
        await sendJson("POST", "/api/subagent-permission", {
          taskId: task.id,
          ...(task.sessionId ? { sessionId: task.sessionId } : {}),
          permission: mode,
        });
        setSubagentPermission(mode);
        writeSubagentPermission(mode);
        setSendError(null);
      } catch (err) {
        setSendError(
          err instanceof Error
            ? `サブエージェント権限を適用できませんでした: ${err.message}`
            : "サブエージェント権限を適用できませんでした。",
        );
      } finally {
        setSubagentPermissionSaving(false);
      }
    },
    [subagentPermission, subagentPermissionSaving, task?.id, task?.sessionId],
  );

  const changeSkillPermission = useCallback(
    async (mode: SkillPermission) => {
      if (mode === skillPermission || skillPermissionSaving || !task?.id) {
        return;
      }
      setSkillPermissionSaving(true);
      try {
        await sendJson("POST", "/api/skill-permission", {
          taskId: task.id,
          ...(task.sessionId ? { sessionId: task.sessionId } : {}),
          permission: mode,
        });
        setSkillPermission(mode);
        writeSkillPermission(mode);
        setSendError(null);
      } catch (err) {
        setSendError(
          err instanceof Error
            ? `スキル権限を適用できませんでした: ${err.message}`
            : "スキル権限を適用できませんでした。",
        );
      } finally {
        setSkillPermissionSaving(false);
      }
    },
    [skillPermission, skillPermissionSaving, task?.id, task?.sessionId],
  );

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


  // pending 権限を自動処理（失敗時は手動カードへフォールバック）:
  // - サブエージェント不許可 かつ task 権限 → 自動 reject（フルアクセスより優先）
  // - スキル不許可 かつ skill 権限 → 自動 reject（フルアクセスより優先）
  // - フルアクセス → 自動 approve（once）
  // task / skill 以外の権限は各設定の影響を受けない。
  useEffect(() => {
    const fullAccess = accessMode === "full";
    if (
      !fullAccess &&
      subagentPermission !== "deny" &&
      skillPermission !== "deny"
    ) {
      autoReplyIdsRef.current.clear();
      setAutoReplyFailedIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    for (const p of permissions) {
      if (autoReplyIdsRef.current.has(p.id)) continue;
      if (autoReplyFailedIds.has(p.id)) continue;
      const action = permissionAutoAction({
        permission: p.permission,
        subagent: subagentPermission,
        skill: skillPermission,
        fullAccess,
      });
      if (action === "manual") continue;
      autoReplyIdsRef.current.add(p.id);
      void onReplyPermission(p, action === "reject" ? "reject" : "once")
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
  }, [
    accessMode,
    subagentPermission,
    skillPermission,
    autoReplyFailedIds,
    permissions,
    onReplyPermission,
  ]);

  useEffect(() => {
    void (async () => {
      try {
        const [providerRes, configRes, agentRes, providerModelsRes] = await Promise.all([
          timedFetch("/api/opencode/provider"),
          timedFetch("/api/opencode/config"),
          timedFetch("/api/opencode/agent"),
          timedFetch("/api/extensions/provider-models"),
        ]);

        const data = providerRes.ok
          ? ((await providerRes.json()) as ProviderResponse)
          : null;
        const config = configRes.ok
          ? ((await configRes.json()) as { model?: string; agent?: unknown })
          : null;
        const providerModels = providerModelsRes.ok
          ? ((await providerModelsRes.json()) as { providers?: ProviderModelsDto[] })
          : null;

        if (data) {
          // An omitted `connected` field is the legacy unrestricted shape.
          // An explicit empty array means that no provider is connected.
          const connectedList = data.connected;
          const connected = connectedList === undefined
            ? null
            : new Set(connectedList);
          const options: ModelOption[] = [];
          const caps: Record<string, { attachment?: boolean; image?: boolean }> = {};
          const map: Record<string, ProviderModelMeta> = {};
          for (const p of data.all ?? []) {
            if (connected && !connected.has(p.id)) continue;
            for (const [mid, m] of Object.entries(p.models ?? {})) {
              const value = `${p.id}::${mid}`;
              options.push({
                value,
                label: formatModelLabel(m.name, mid),
                group: p.name || p.id,
                image: m.capabilities?.input?.image === true,
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
          const enabledOptions = filterEnabledModelOptions(
            options,
            providerModels?.providers,
          );
          // Auto is inserted *after* filter/sort on purpose: providerSortKey
          // ("auto") is the unknown-provider tail value, so sorting would sink
          // it to the bottom (same rationale as HomeView).
          setModelOptions([
            AUTO_MODEL_OPTION,
            ...sortModelOptions(
              enabledOptions,
              modelOrderPreferenceFromProviders(providerModels?.providers),
            ),
          ]);
          setModelCapabilities(caps);
          setProviderModelsMap(map);

          // Auto resolution inputs (addendum spec §3). Keep the *unfiltered*
          // provider list — chooseAutoModel applies the connected filter
          // itself — and derive the disabled record from the extensions DTO
          // (absent DTO = everything allowed, mirroring the fail-open policy
          // of filterEnabledModelOptions).
          const autoProviders: AutoCandidateProvider[] = (data.all ?? []).map(
            (p) => ({
              id: p.id,
              models: Object.fromEntries(
                Object.entries(p.models ?? {}).map(([mid, m]) => [
                  mid,
                  {
                    name: m.name,
                    variants: m.variants,
                    capabilities: m.capabilities,
                  },
                ]),
              ),
            }),
          );
          const autoDisabled: Record<string, true> = {};
          for (const provider of providerModels?.providers ?? []) {
            if (provider.enabled === false) autoDisabled[provider.id] = true;
            for (const providerModel of provider.models ?? []) {
              if (providerModel.enabled === false) {
                autoDisabled[`${provider.id}::${providerModel.id}`] = true;
              }
            }
          }
          const usage = await readCodexBarAutoUsage();
          setAutoInputs({
            providers: autoProviders,
            connected: connectedList,
            disabled: autoDisabled,
            usage,
          });

          // Prefer user-configured default model, then OpenCode config.model
          // (provider/modelID), then provider defaults.
          let initial = "";
          const savedDefault = readDefaultModel();
          if (
            savedDefault &&
            enabledOptions.some((o) => o.value === savedDefault)
          ) {
            initial = savedDefault;
          }
          if (!initial) {
            const cfg = config?.model?.trim();
            if (cfg) {
              const slash = cfg.indexOf("/");
              if (slash > 0) {
                const value = `${cfg.slice(0, slash)}::${cfg.slice(slash + 1)}`;
                if (enabledOptions.some((o) => o.value === value)) initial = value;
              }
            }
          }
          if (!initial) {
            for (const pid of connectedList ?? []) {
              const mid = data.default?.[pid];
              if (!mid) continue;
              const value = `${pid}::${mid}`;
              if (enabledOptions.some((o) => o.value === value)) {
                initial = value;
                break;
              }
            }
          }
          if (!initial && enabledOptions[0]) initial = enabledOptions[0].value;
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
      const data = await getJson<{
        task: TaskSummary;
        goalLoop?: GoalLoopDto | null;
      }>(`/api/tasks/${taskId}`);
      if (
        sequence !== refreshSequenceRef.current ||
        taskIdRef.current !== requestedTaskId
      ) {
        return;
      }
      rememberTaskSummary(data.task);
      taskRef.current = data.task;
      setTask(data.task);
      if ("goalLoop" in data) setGoalLoop(data.goalLoop ?? null);
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

  const refreshGoalLoop = useCallback(async () => {
    try {
      const data = await getJson<{ loop: GoalLoopDto | null }>(
        `/api/tasks/${taskId}/goal-loop`,
      );
      if (taskIdRef.current !== taskId) return;
      setGoalLoop(data.loop ?? null);
      setGoalLoopError(null);
    } catch (err) {
      setGoalLoopError(
        err instanceof Error ? err.message : "Goalループを読み込めません",
      );
    }
  }, [taskId]);

  /**
   * Resolve Auto for a client-side send (addendum spec §4). Follow-ups bypass
   * `POST /api/tasks`, so the shared pure resolver runs here instead of in the
   * BFF. Returns null when the provider snapshot is missing or no candidate
   * survives the connected / enabled / image filters.
   */
  const resolveAutoSelection = useCallback(
    (
      text: string,
      hasImages: boolean,
      attachmentCount = 0,
    ): AutoDecision | null => {
      if (!autoInputs) return null;
      return chooseAutoModel({
        providers: autoInputs.providers,
        connected: autoInputs.connected,
        disabled: autoInputs.disabled,
        // Slash commands are classified from their raw text (no expansion).
        // Unlike a brand-new task, a follow-up has real context: how deep the
        // conversation already is and whether the previous turn failed both
        // raise the tier by one step.
        tier: classifyPrompt(text, {
          hasImages,
          attachmentCount,
          historyMessageCount: streamMessages.length,
          recentFailure: streamSessionError !== null,
        }),
        mode: autoOptimize,
        hasImages,
        usage: autoInputs.usage,
      });
    },
    [autoInputs, autoOptimize, streamMessages.length, streamSessionError],
  );

  /** Start a loop with `goal`. Returns true when the loop was created. */
  const startGoalLoop = useCallback(
    async (goal: string): Promise<boolean> => {
      const sessionId = taskRef.current?.sessionId;
      if (!sessionId || !goal.trim()) return false;
      setGoalLoopBusy(true);
      setGoalLoopError(null);
      try {
        const [providerID, modelID] = model ? model.split("::") : [];
        // Auto: the loop runs server-side later, so it needs a concrete model
        // rather than the "auto" sentinel. An agent with its own model wins
        // (same precedence as POST /api/tasks), leaving both fields omitted.
        const isAuto = model === AUTO_MODEL_VALUE;
        const agentPinnedModel = agent ? agentModels[agent] : undefined;
        let decision: AutoDecision | undefined;
        if (isAuto && !agentPinnedModel) {
          const resolved = resolveAutoSelection(goal, false);
          if (!resolved) {
            setGoalLoopError(AUTO_NO_CANDIDATE_ERROR);
            return false;
          }
          decision = resolved;
        }
        const loopModel = decision
          ? { providerID: decision.providerID, modelID: decision.modelID }
          : providerID && modelID
            ? { providerID, modelID }
            : undefined;
        // A fixed agent model bypasses Auto resolution, but it must still
        // receive the manually selected Intelligence effort.
        const loopVariant = isAuto && !agentPinnedModel
          ? (decision?.variant ?? "")
          : intelligence;
        const data = await sendJson<{ loop: GoalLoopDto }>(
          "POST",
          `/api/tasks/${taskId}/goal-loop`,
          {
            sessionId,
            goal,
            acceptance: goalLoopAcceptance
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean),
            maxTurns: goalLoopMaxTurns,
            ...(agent ? { agent } : {}),
            ...(loopModel ? { model: loopModel } : {}),
            ...(loopVariant ? { variant: loopVariant } : {}),
          },
        );
        if (decision) setAutoFollowUpNotice(formatAutoDecisionNotice(decision));
        setGoalLoop(data.loop);
        setGoalLoopAcceptance("");
        setGoalLoopEnabled(false);
        notifyTasksChanged();
        return true;
      } catch (err) {
        setGoalLoopError(
          err instanceof Error ? err.message : "Goalループの開始に失敗しました",
        );
        return false;
      } finally {
        setGoalLoopBusy(false);
      }
    },
    [
      agent,
      agentModels,
      goalLoopAcceptance,
      goalLoopMaxTurns,
      intelligence,
      model,
      resolveAutoSelection,
      taskId,
    ],
  );

  const changeGoalLoopState = useCallback(
    async (action: "pause" | "resume" | "stop") => {
      setGoalLoopBusy(true);
      setGoalLoopError(null);
      try {
        const data = await sendJson<{ loop: GoalLoopDto }>(
          "PATCH",
          `/api/tasks/${taskId}/goal-loop`,
          { action },
        );
        setGoalLoop(data.loop);
        if (action === "resume") setGoalLoopError(null);
        notifyTasksChanged();
      } catch (err) {
        setGoalLoopError(err instanceof Error ? err.message : "Goalループ操作に失敗しました");
      } finally {
        setGoalLoopBusy(false);
      }
    },
    [taskId],
  );

  const updateGoalLoopMaxTurns = useCallback(
    async (maxTurns: number) => {
      setGoalLoopBusy(true);
      setGoalLoopError(null);
      try {
        const data = await sendJson<{ loop: GoalLoopDto }>(
          "PATCH",
          `/api/tasks/${taskId}/goal-loop`,
          { action: "updateMaxTurns", maxTurns },
        );
        setGoalLoop(data.loop);
        notifyTasksChanged();
      } catch (err) {
        setGoalLoopError(
          err instanceof Error ? err.message : "最大ターン数の更新に失敗しました",
        );
      } finally {
        setGoalLoopBusy(false);
      }
    },
    [taskId],
  );

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
  /**
   * A loop that is still owned by the scheduler. While live, GoalLoopPanel owns
   * the loop UI, so the composer toggle is hidden to avoid two competing
   * entry points.
   */
  const goalLoopLive =
    goalLoop?.status === "queued" ||
    goalLoop?.status === "running" ||
    goalLoop?.status === "verifying_completed" ||
    goalLoop?.status === "paused";
  /** Composer is waiting for POST /goal-loop to answer. */
  const goalLoopStarting = goalLoopEnabled && !goalLoopLive && goalLoopBusy;
  // NextAction invalidation key: changes when conversation content, revert
  // position, or task changes — so stale suggestions are discarded.
  const nextActionInvalidateKey = useMemo(() => {
    const msgs = stream.visibleMessages;
    const lastId = msgs.length > 0 ? msgs[msgs.length - 1]?.info.id ?? "" : "";
    const revertId = stream.revert?.messageID ?? "";
    return `${taskId}:${msgs.length}:${lastId}:${revertId}`;
  }, [taskId, stream.visibleMessages, stream.revert]);
  // Show NextAction only when idle, conversation loaded, no attention pending.
  const showNextAction =
    !!task?.sessionId &&
    !working &&
    stream.loaded &&
    stream.visibleMessages.length > 0 &&
    stream.permissions.length === 0 &&
    stream.questions.length === 0;
  const [sending, setSending] = useState(false);
  /** Scope that owns the in-flight send — other sessions must stay editable. */
  const [sendingScopeKey, setSendingScopeKey] = useState<string | null>(null);
  const composerLocked =
    working || (sending && sendingScopeKey === composerScopeKey);
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

  useEffect(() => {
    const activeLoop =
      goalLoop?.status === "queued" ||
      goalLoop?.status === "running" ||
      goalLoop?.status === "verifying_completed";
    if (!pageVisible || !activeLoop) return;
    const poll = setInterval(() => void refreshGoalLoop(), ACTIVE_TASK_POLL_MS);
    return () => clearInterval(poll);
  }, [goalLoop?.status, pageVisible, refreshGoalLoop]);

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
      playSessionCompleteSound();
      setDiffKey((k) => k + 1);
      void refreshTask();
      // The engine sometimes omits the final `todo.updated` SSE event when a
      // session transitions to idle, leaving the plan badge stuck on "進行中".
      // Reconcile the todo list from the server here.
      void refreshTodos();
      // R3 skips message init while busy; reconcile the final REST snapshot now.
      void resync();
      if (goalLoop) void refreshGoalLoop();
    }
    prevStatusRef.current = cur;
  }, [goalLoop, refreshGoalLoop, refreshTask, refreshTodos, resync, streamScopeKey, streamStatusType]);

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

  const isAtBottom = useCallback((el: HTMLElement) => {
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
  }, []);

  const isAtTop = useCallback((el: HTMLElement) => {
    return el.scrollTop <= 80;
  }, []);

  const scrollToBottom = useCallback(
    (el: HTMLElement, behavior: ScrollBehavior = "auto") => {
      el.scrollTo({ top: el.scrollHeight, behavior });
    },
    [],
  );

  const scrollToTop = useCallback(
    (el: HTMLElement, behavior: ScrollBehavior = "auto") => {
      el.scrollTo({ top: 0, behavior });
    },
    [],
  );

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = isAtBottom(el);
    stickRef.current = atBottom;
    setShowScrollButton(!atBottom);
    setShowScrollTopButton(!isAtTop(el));
  }, [isAtBottom, isAtTop]);

  // Auto-stick scroll to bottom. We intentionally avoid rAF timeouts because
  // mobile Safari can ignore scrollTo during inertial scrolling; re-running
  // the effect when the stream changes keeps the conversation pinned without
  // fighting the user when they manually scroll up.
  useEffect(() => {
    if (!stickRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    scrollToBottom(el, "auto");
  }, [
    scrollToBottom,
    stream.messages,
    stream.permissions,
    stream.questions,
    stream.status,
  ]);

  // Re-pin when the content height changes asynchronously (images, Markdown,
  // code blocks, tool output). A ResizeObserver on the content wrapper catches
  // layout shifts that the stream-deps effect alone misses. We must observe
  // the content wrapper (contentRef), not the scroller itself: the scroller
  // has a fixed flex height with overflow-y-auto, so its own border-box never
  // changes size when its children grow, and ResizeObserver would never fire.
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const pinned = () => {
      if (!stickRef.current) return;
      if (isAtBottom(scroller)) return;
      scrollToBottom(scroller, "auto");
    };
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(pinned);
      ro.observe(content);
      return () => ro.disconnect();
    }
    // Fallback for test/legacy environments without ResizeObserver.
    const id = setInterval(pinned, 200);
    return () => clearInterval(id);
  }, [isAtBottom, scrollToBottom]);

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

  const touchActivity = useCallback(async (sessionId: string, taskId: string) => {
    try {
      // Activity ordering is best-effort; never block sending for more than 5s.
      await Promise.race([
        sendJson("POST", `/api/tasks/${taskId}/activity`, {
          sessionId,
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch {
      // Activity ordering is best-effort and must not block the prompt.
    }
  }, []);

  const refreshSessionTitle = useCallback(async (taskId: string, sessionId: string) => {
    try {
      await sendJson(
        "POST",
        `/api/workspaces/${taskId}/sessions/${sessionId}/refresh-title`,
      );
      notifyTasksChanged();
    } catch {
      // Title regeneration is best-effort and must not block the prompt.
    }
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || composerLocked) return;
    const sendScopeKey = composerScopeKey;
    const sendSessionId = taskRef.current?.sessionId;
    const sendTaskId = taskRef.current?.id;
    if (!sendSessionId || !sendTaskId || !sendScopeKey) return;
    // Goal loop mode: the composer text is the goal, not a chat turn. Hand it
    // to the loop API and restore the draft when the API rejects it.
    if (goalLoopEnabled && !goalLoopLive) {
      if (attachments.length > 0) {
        setGoalLoopError(
          "Goalループでは添付ファイルを利用できません。添付を削除してから開始してください。",
        );
        return;
      }
      if (!text) return;
      rememberComposerDraft(sendScopeKey, { input: "", attachments: [] });
      setInput("");
      setSendError(null);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      stickRef.current = true;
      const ok = await startGoalLoop(text);
      if (!ok) {
        rememberComposerDraft(sendScopeKey, { input: text, attachments });
        if (composerScopeRef.current === sendScopeKey) setInput(text);
      }
      return;
    }
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
    const sendingImageSupported =
      sendingModelKey === AUTO_MODEL_VALUE
        ? // Auto has no capabilities of its own: pass when at least one
          // connected model could take the image. The resolution below only
          // considers image-capable candidates, so the actual send is safe.
          Object.values(modelCapabilities).some(
            (capability) =>
              capability.image === true || capability.attachment === true,
          )
        : sendingModelKey
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
    if (attachments.length > MAX_IMAGE_COUNT) {
      setSendError(`画像は最大 ${MAX_IMAGE_COUNT} 枚まで添付できます。`);
      return;
    }
    if (
      attachments.some((a) => estimateDataUrlBytes(a.uri) > MAX_IMAGE_SIZE_BYTES)
    ) {
      setSendError(
        `各画像は ${Math.floor(MAX_IMAGE_SIZE_BYTES / (1024 * 1024))} MB 以下にしてください。`,
      );
      return;
    }
    // Auto: resolve the concrete model client-side (follow-ups never reach the
    // BFF). Deliberately placed before the draft is cleared so an unresolvable
    // Auto aborts without eating the user's input. An agent with its own model
    // wins, matching the POST /api/tasks precedence.
    const isAuto = model === AUTO_MODEL_VALUE;
    const autoAgentPinnedModel = agent ? agentModels[agent] : undefined;
    let autoDecision: AutoDecision | undefined;
    if (isAuto && !autoAgentPinnedModel) {
      const resolved = resolveAutoSelection(
        text,
        hasImage,
        attachments.length,
      );
      if (!resolved) {
        setSendError(AUTO_NO_CANDIDATE_ERROR);
        return;
      }
      autoDecision = resolved;
    }
    const files = attachments.map((a) => ({
      uri: a.uri,
      mime: a.mime,
      ...(a.name ? { name: a.name } : {}),
    }));
    const snapshotAttachments = attachments;
    rememberComposerDraft(sendScopeKey, { input: "", attachments: [] });
    setInput("");
    setAttachments([]);
    setSendError(null);
    setSendingScopeKey(sendScopeKey);
    setSending(true);
    stickRef.current = true;
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    try {
      if (
        goalLoop?.status === "queued" ||
        goalLoop?.status === "running" ||
        goalLoop?.status === "verifying_completed"
      ) {
        let paused: { loop: GoalLoopDto };
        try {
          paused = await sendJson<{ loop: GoalLoopDto }>(
            "PATCH",
            `/api/tasks/${sendTaskId}/goal-loop`,
            { action: "pause" },
          );
        } catch (err) {
          throw new Error(
            `Goalループを一時停止できないため手動送信を中止しました: ${
              err instanceof Error ? err.message : "一時停止に失敗しました"
            }`,
          );
        }
        if (paused.loop.status !== "paused") {
          throw new Error(
            "Goalループを一時停止できないため手動送信を中止しました。状態が競合したため、現在の状態を確認してから再試行してください。",
          );
        }
        setGoalLoop(paused.loop);
      }
      await touchActivity(sendSessionId, sendTaskId);
      // `"auto".split("::")` yields `["auto"]`, so modelID stays undefined and
      // the manual branch below naturally omits `model` for Auto.
      const [providerID, modelID] = model ? model.split("::") : [];
      const sendModel = autoDecision
        ? {
            providerID: autoDecision.providerID,
            modelID: autoDecision.modelID,
          }
        : providerID && modelID
          ? { providerID, modelID }
          : undefined;
      // A fixed agent model wins over Auto, while retaining the manual
      // Intelligence selection for the agent's concrete model.
      const sendVariant = isAuto && !autoAgentPinnedModel
        ? (autoDecision?.variant ?? "")
        : intelligence;
      const opts = {
        ...(agent ? { agent } : {}),
        ...(sendModel ? { model: sendModel } : {}),
        ...(files.length > 0 ? { files } : {}),
        ...(sendVariant ? { variant: sendVariant } : {}),
        sessionId: sendSessionId,
      };
      const parsed = parseCommandSubmit(text, slashCommands);
      if (parsed) {
        await stream.sendCommand(parsed.command, parsed.arguments, opts);
      } else {
        await stream.sendPrompt(text, opts);
      }
      if (autoDecision) {
        setAutoFollowUpNotice(formatAutoDecisionNotice(autoDecision));
      }
      void refreshSessionTitle(sendTaskId, sendSessionId);
      // Remember the model actually applied to this submission so the next
      // new session preselects it.
      writeLastUsedModel(sendingModelKey || null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "送信に失敗しました";
      // Restore the draft onto the session that owned the send — never the
      // session the user may have switched to mid-flight.
      rememberComposerDraft(sendScopeKey, {
        input: text,
        attachments: snapshotAttachments,
      });
      if (composerScopeRef.current === sendScopeKey) {
        setSendError(message);
        setInput(text);
        setAttachments(snapshotAttachments);
      }
    } finally {
      setSending(false);
      setSendingScopeKey(null);
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
    refreshSessionTitle,
    composerScopeKey,
    goalLoop?.status,
    goalLoopEnabled,
    goalLoopLive,
    resolveAutoSelection,
    startGoalLoop,
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
  const imageSupported =
    effectiveModelKey === AUTO_MODEL_VALUE
      ? // Auto carries no capabilities: keep the attachment controls usable
        // when any connected model could take an image. The send-time
        // resolution then restricts the candidates to image-capable models.
        Object.values(modelCapabilities).some(
          (capability) =>
            capability.image === true || capability.attachment === true,
        )
      : effectiveModelKey
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
    if (!imageSupported) {
      setSendError(
        "選択中のエージェント/モデルは画像入力に対応していないか、画像対応を確認できません。画像対応モデルを選んでください。",
      );
      return;
    }
    const list = Array.from(files).filter((f) => IMAGE_MIME_RE.test(f.type));
    if (list.length === 0) return;

    const candidates: Attachment[] = [];
    let rejected = 0;
    for (const f of list) {
      if (f.size > MAX_IMAGE_SIZE_BYTES) {
        rejected += 1;
        continue;
      }
      try {
        const uri = await readFileAsDataUrl(f);
        if (estimateDataUrlBytes(uri) > MAX_IMAGE_SIZE_BYTES) {
          rejected += 1;
          continue;
        }
        candidates.push({ uri, mime: f.type, name: f.name, preview: uri });
      } catch {
        rejected += 1;
      }
    }

    const current = attachmentsRef.current;
    const room = Math.max(0, MAX_IMAGE_COUNT - current.length);
    const take = candidates.slice(0, room);
    const appended = take.length;
    const next = take.length > 0 ? [...current, ...take] : current;
    attachmentsRef.current = next;
    setAttachments(next);
    if (appended > 0) stickRef.current = true;

    const skipped = rejected + (candidates.length - appended);
    if (skipped > 0) {
      setSendError(
        `一部の画像をスキップしました（上限 ${MAX_IMAGE_COUNT} 枚 / ${Math.floor(MAX_IMAGE_SIZE_BYTES / (1024 * 1024))} MB）。`,
      );
    }
  }, [imageSupported]);

  const removeAttachment = useCallback((index: number) => {
    const next = attachmentsRef.current.filter((_, i) => i !== index);
    attachmentsRef.current = next;
    setAttachments(next);
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
    const sessionId = taskRef.current?.sessionId;
    const activityTaskId = taskRef.current?.id;
    if (!sessionId || !activityTaskId) {
      throw new Error(`セッションが見つかりません`);
    }
    setSendError(null);
    setAgent(`build`);
    setIntelligence("");
    stickRef.current = true;
    try {
      await touchActivity(sessionId, activityTaskId);
      await stream.sendPrompt(PLAN_APPROVAL_PROMPT, {
        agent: `build`,
        sessionId,
      });
      void refreshSessionTitle(activityTaskId, sessionId);
    } finally {
      notifyTasksChanged();
    }
  }, [working, stream, touchActivity, refreshSessionTitle]);

  const intelligenceVariants = useMemo(() => {
    if (!effectiveModelKey) return [];
    const modelMeta = providerModelsMap[effectiveModelKey];
    if (!modelMeta) return [];
    return getIntelligenceVariants(modelMeta);
  }, [effectiveModelKey, providerModelsMap]);

  useEffect(() => {
    if (!intelligence) return;
    if (!intelligenceVariants.some((v) => v === intelligence)) {
      setIntelligence("");
    }
  }, [intelligence, intelligenceVariants]);

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

  // Zone C data: kebab groups. On mobile, compact is available here because
  // the header does not have room for a direct action. Files/graph/diff stay
  // in Zone B at lg, while task, session, panels, and danger actions are
  // available from the kebab.
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
    if (!isMd && hasSession) {
      sessionItems.unshift({
        id: "compact",
        label: "コンテキスト圧縮",
        icon: <Shrink className="h-4 w-4" />,
        onSelect: sessionActions.compact,
        disabled: sessionActions.busy !== null,
        busy: sessionActions.busy === "compact",
      });
    }
    // Mobile: expose stop in kebab since the header button is hidden below md.
    if (!isMd && working) {
      sessionItems.unshift({
        id: "abort",
        label: "停止",
        icon: <Square className="h-4 w-4 fill-current" />,
        onSelect: () => void stream.abort(),
        disabled: sessionActions.busy !== null,
        danger: true,
      });
    }

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
        disabled: working || sessionActions.busy !== null,
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
    sessionActions.compact,
    sessionActions.revert,
    sessionActions.unrevert,
    lastRevertMessageId,
    isMd,
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

  const setScrollTarget = useMobileScrollTarget();

  if (loadError) {
    return (
      <div className="flex h-full flex-col">
        <MobileMenuHeader />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4">
          <p className="text-sm text-danger">{loadError}</p>
          <Link href="/" className="text-sm text-accent underline">
            ホームへ戻る
          </Link>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex h-full flex-col">
        <MobileMenuHeader />
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Spinner />
        </div>
      </div>
    );
  }

  const chatVisible = tab === "chat";
  const diffVisible = tab === "diff";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 pt-[env(safe-area-inset-top)]">
        <MobileMenuButton className="-ml-1" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">
              {task.title}
            </h1>
          </div>
          {/* Mobile-only compact context usage row: the sm:flex meta row
              below carries branch/project/cost too, but that whole row is
              hidden below sm, so phones would otherwise show no context
              indicator at all. */}
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-faint sm:hidden">
            <StatusBadge status={working ? "working" : task.status} />
            {stream.connection === "reconnecting" && (
              <span className="shrink-0 text-warning">再接続中…</span>
            )}
            {stream.connection === "down" && (
              <span className="shrink-0 text-danger">切断（再試行中）</span>
            )}
            {contextUsage && (
              <span
                className="flex min-w-0 shrink-0 items-center gap-1.5"
                title={`コンテキスト使用量: ${formatTokens(contextUsage.used)} / ${formatTokens(contextUsage.limit)}トークン（${contextUsage.pct}%）`}
              >
                <span className="h-1.5 w-8 shrink-0 overflow-hidden rounded-full bg-surface-2">
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
            )}
          </div>
          <div className="mt-0.5 hidden min-w-0 items-center gap-1 text-xs text-faint sm:flex">
            <StatusBadge status={working ? "working" : task.status} />
            {working && currentTool && (
              <span className="max-w-[12rem] truncate text-working">
                {currentTool}
              </span>
            )}
            {todoBadge && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">
                <ListTodo className="h-3 w-3" />
                {todoBadge}
              </span>
            )}
            {stream.connection === "reconnecting" && (
              <span className="shrink-0 text-warning">再接続中…</span>
            )}
            {stream.connection === "down" && (
              <span className="shrink-0 text-danger">切断（再試行中）</span>
            )}
            {(task.branch || (task.cost ?? 0) > 0 || contextUsage) && (
              <span className="mx-1 shrink-0">·</span>
            )}
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
        </div>
        {/* Mobile-only global attention entry (desktop shows it in sidebar). */}
        <span className="md:hidden">
          <AttentionBadge />
        </span>
        {/* Right toolbar: outer wrapper (overflow visible) keeps the kebab
            popup from being clipped. Inner scroll container holds only
            Zone A / Zone B so horizontal scroll is limited to those ops. */}
        <div className="flex min-w-0 shrink-0 items-center gap-0.5 sm:gap-1">
          <div className="flex max-w-[60vw] items-center gap-0.5 overflow-x-auto sm:max-w-none sm:overflow-visible [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Zone A: direct actions are retained at md and above. Mobile has
              no header stop button and exposes compact through the kebab. */}
          {isMd && working && (
            <Button variant="danger" size="sm" onClick={() => void stream.abort()}>
              <Square className="h-3 w-3 fill-current" />
              <span className="hidden sm:inline">停止</span>
            </Button>
          )}
          {isMd && task.sessionId && (
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

      {/* Single Auto banner: a follow-up resolution takes priority over the
          initial hand-off chip / retry notice (addendum spec §6). */}
      {autoBannerText && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2 text-sm text-muted">
          <span className="min-w-0 break-words">{autoBannerText}</span>
          <button
            type="button"
            aria-label="Auto の選定結果を閉じる"
            onClick={dismissAutoBanner}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:bg-surface-3 hover:text-text"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
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
            {/* Scroll viewport wrapper. The jump-to-latest button must be a
                sibling of the scroller, not a child: an absolutely positioned
                child of an overflow container is laid out against the scrolled
                content box, so it drifts with the content instead of staying
                pinned to the visible viewport. */}
            <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              ref={(el) => {
                scrollRef.current = el;
                setScrollTarget(el);
              }}
              data-testid="message-scroller"
              onScroll={onScroll}
              className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
              <div
                ref={contentRef}
                className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6"
              >
                <GoalLoopPanel
                  loop={goalLoop}
                  busy={goalLoopBusy}
                  onAction={(action) => void changeGoalLoopState(action)}
                  onUpdateMaxTurns={(n) => void updateGoalLoopMaxTurns(n)}
                />
                {!stream.loaded && stream.messages.length === 0 && (
                  <div className="flex justify-center py-10">
                    <Spinner />
                  </div>
                )}
                {timeline.map((m) => {
                  const messageTime =
                    m.info.time?.completed ?? m.info.time?.created ?? null;
                  return (
                  <div key={m.info.id} className="flex flex-col gap-2">
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
                          effort={task.variant}
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
                      <div className="flex justify-end">
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
                {stream.permissions
                  .filter(
                    (p) =>
                      autoReplyFailedIds.has(p.id) ||
                      permissionAutoAction({
                        permission: p.permission,
                        subagent: subagentPermission,
                        skill: skillPermission,
                        fullAccess: accessMode === "full",
                      }) === "manual",
                  )
                  .map((p) => (
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
            {(showScrollTopButton || showScrollButton) && stream.messages.length > 0 && (
              <div className="absolute right-4 bottom-4 z-50 flex flex-col gap-2">
                {showScrollTopButton && (
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="最初のメッセージへ"
                    title="最初のメッセージへ"
                    className="h-10 w-10 rounded-full border border-border-strong bg-surface shadow-lg ring-1 ring-border"
                    onClick={() => {
                      const el = scrollRef.current;
                      if (!el) return;
                      scrollToTop(el, "smooth");
                      stickRef.current = false;
                      setShowScrollTopButton(false);
                    }}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                )}
                {showScrollButton && (
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="最新のメッセージへ"
                    title="最新のメッセージへ"
                    className="h-10 w-10 rounded-full border border-border-strong bg-surface shadow-lg ring-1 ring-border"
                    onClick={() => {
                      const el = scrollRef.current;
                      if (!el) return;
                      scrollToBottom(el, "smooth");
                      stickRef.current = true;
                      setShowScrollButton(false);
                    }}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
            </div>
            </>
          )}

          {/* Composer */}
          <div className="shrink-0 border-t border-border bg-surface px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto max-w-5xl">
              <TodoPanel todos={stream.todos} forceOpen={working && isMd} />
              {showNextAction && (
                <NextAction
                  taskId={taskId}
                  sessionId={task.sessionId!}
                  model={model || undefined}
                  agent={agent || undefined}
                  onApply={restoreToComposer}
                  invalidateKey={nextActionInvalidateKey}
                  isMd={isMd}
                />
              )}
              {sendError && (
                <p
                  role="alert"
                  className="mt-2 rounded-lg border border-danger/30 bg-danger-bg px-3 py-1.5 text-xs text-danger"
                >
                  {sendError}
                </p>
              )}
              {goalLoopError && !goalLoopLive && (
                <p
                  role="alert"
                  className="mt-2 rounded-lg border border-danger/30 bg-danger-bg px-3 py-1.5 text-xs text-danger"
                >
                  {goalLoopError}
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
              <Composer
                className="relative mt-2 rounded-2xl border border-border bg-bg px-3 py-2 focus-within:border-border-strong focus-within:ring-2 focus-within:ring-primary/20"
                onDrop={onDrop}
                onDragOver={onDragOver}
                slash={
                  slashOpen
                    ? {
                        items: slashItems,
                        activeIndex: slashIndex,
                        onHover: setSlashIndex,
                        onSelect: (cmd) => applySlash(cmd.name),
                      }
                    : undefined
                }
                attachments={attachments}
                onRemoveAttachment={removeAttachment}
                attachmentRemovalLabel={() => "添付を削除"}
                textarea={{
                  ref: textareaRef,
                  value: input,
                  rows: 1,
                  style: { fontSize: "16px", textSizeAdjust: "100%", WebkitTextSizeAdjust: "100%" },
                  ariaLabel: "フォローアップを送信",
                  busy: composerLocked,
                  disabled: !task.sessionId,
                  readOnly: composerLocked,
                  onChange: (event) => {
                    setInput(event.target.value);
                    setCursor(event.target.selectionStart ?? event.target.value.length);
                    const el = event.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                  },
                  onClick: syncCursor,
                  onKeyUp: syncCursor,
                  onSelect: syncCursor,
                  onPaste,
                  onCompositionStart: () => (composingRef.current = true),
                  onCompositionEnd: () => (composingRef.current = false),
                  onKeyDown: (event) => {
                    if (slashOpen && !composingRef.current) {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setSlashIndex((i) => (i + 1) % slashItems.length);
                        return;
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setSlashIndex((i) => (i - 1 + slashItems.length) % slashItems.length);
                        return;
                      }
                      if (event.key === "Enter" || event.key === "Tab") {
                        event.preventDefault();
                        const item = slashItems[slashIndex];
                        if (item) applySlash(item.name);
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setSlashDismissed(true);
                        return;
                      }
                    }
                    if (event.key === "Enter" && !event.shiftKey && !composerLocked && !composingRef.current) {
                      event.preventDefault();
                      void send();
                    }
                  },
                  placeholder: goalLoopEnabled && !goalLoopLive
                    ? "達成したい目標を入力…（Enter で開始）"
                    : "フォローアップを送信…",
                  className: "max-h-40 w-full resize-none bg-transparent py-1.5 text-[0.925rem] outline-none placeholder:text-faint",
                }}
                afterTextarea={
                  goalLoopEnabled && !goalLoopLive ? (
                    <GoalLoopOptions
                      acceptance={goalLoopAcceptance}
                      maxTurns={goalLoopMaxTurns}
                      disabled={goalLoopBusy}
                      onAcceptanceChange={setGoalLoopAcceptance}
                      onMaxTurnsChange={setGoalLoopMaxTurns}
                    />
                  ) : undefined
                }
                attachmentControl={{
                  inputRef: fileInputRef,
                  inputDisabled: !imageSupported,
                  buttonDisabled: !task.sessionId || working || !imageSupported,
                  buttonTitle: imageSupported
                    ? "画像を添付"
                    : "選択中のエージェント/モデルは画像入力に対応していません",
                  onFilesSelected: (files) => void addImageFiles(files),
                  onTrigger: () => fileInputRef.current?.click(),
                }}
                toolbar={<>
                    <VoiceInputButton
                      voice={voice}
                      onTranscript={onVoiceTranscript}
                      onNativeVoiceStart={() => textareaRef.current?.focus()}
                      disabled={voiceDisabled}
                    />
                    {modelOptions.length > 0 && (
                      <ModelSelect
                        value={model}
                        options={modelOptions}
                        onChange={(value) => {
                          setModel(value);
                          setIntelligence("");
                          // The user explicitly picked a model; suppress the
                          // auto-seed effect so later assistant turns can't
                          // reset the model/intelligence back to defaults.
                          seededModelRef.current = true;
                        }}
                        disabled={!task.sessionId}
                        className="max-w-[11rem] shrink-0 sm:max-w-48"
                      />
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
                    {/* Shares the effort slot with IntelligenceSelect: Auto
                        decides the effort itself. The variant list is empty
                        for Auto unless an agent pins its own model, in which
                        case Auto is bypassed and the effort selector wins. */}
                    {model === AUTO_MODEL_VALUE &&
                      intelligenceVariants.length === 0 && (
                        <AutoOptimizeSelect
                          value={autoOptimize}
                          onChange={changeAutoOptimize}
                          disabled={!task.sessionId}
                        />
                      )}
                    {agents.length > 0 && (
                      <GhostSelect
                        value={agent}
                        onChange={(value) => {
                          setAgent(value);
                          setIntelligence("");
                        }}
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
                      disabled={!task.sessionId || subagentPermissionSaving}
                      className="h-8 shrink-0"
                    />
                    <SkillPermissionSelect
                      value={skillPermission}
                      onChange={(mode) => void changeSkillPermission(mode)}
                      disabled={!task.sessionId || skillPermissionSaving}
                      className="h-8 shrink-0"
                    />
                    <SubagentPermissionSelect
                      value={subagentPermission}
                      onChange={(mode) => void changeSubagentPermission(mode)}
                      disabled={!task.sessionId || subagentPermissionSaving}
                      className="h-8 shrink-0"
                    />
                    {/* 実行中ループの操作は GoalLoopPanel が担うので、その間は隠す */}
                    {!goalLoopLive && (
                      <GoalLoopToggle
                        enabled={goalLoopEnabled}
                        disabled={!task.sessionId || goalLoopBusy || working}
                        onToggle={() => setGoalLoopEnabled((v) => !v)}
                      />
                    )}
                  </>}
                action={working ? (
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
                      aria-label={
                        goalLoopEnabled && !goalLoopLive
                          ? "Goalループを開始"
                          : "送信"
                      }
                      busy={goalLoopStarting}
                      disabled={
                        goalLoopEnabled && !goalLoopLive
                          ? !input.trim() || !task.sessionId || goalLoopBusy
                          : (!input.trim() && attachments.length === 0) ||
                            !task.sessionId
                      }
                      onClick={() => void send()}
                    >
                      {!goalLoopStarting && <ArrowUp className="h-4.5 w-4.5" />}
                    </Button>
                  )}
              />
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
                void writeSideWidthToServer(SIDE_DEFAULT);
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
