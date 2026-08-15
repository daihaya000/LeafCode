"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Bot,
  FolderGit2,
  GitBranch,
  Play,
} from "lucide-react";
import { AccessModeSelect } from "@/components/AccessModeSelect";
import { SkillPermissionSelect } from "@/components/SkillPermissionSelect";
import { SubagentPermissionSelect } from "@/components/SubagentPermissionSelect";
import { AddProjectButton } from "@/components/AddProjectButton";
import { Composer, type ComposerAttachment } from "@/components/Composer";
import { GoalLoopOptions, GoalLoopToggle } from "@/components/GoalLoopComposer";
import { AutoOptimizeSelect } from "@/components/AutoOptimizeSelect";
import { IntelligenceSelect } from "@/components/IntelligenceSelect";
import { ModelSelect } from "@/components/ModelSelect";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { Button, GhostSelect, cx } from "@/components/ui";
import { useVoiceInput } from "@/lib/use-voice-input";
import { useModelConfigState } from "@/lib/hooks/use-model-config-state";
import {
  ACCESS_MODE_EVENT,
  ACCESS_MODE_STORAGE_KEY,
  readAccessMode,
  writeAccessMode,
  type AccessMode,
} from "@/lib/access-mode";
import {
  readSubagentPermission,
  SUBAGENT_PERMISSION_EVENT,
  SUBAGENT_PERMISSION_STORAGE_KEY,
  writeSubagentPermission,
  type SubagentPermission,
} from "@/lib/subagent-permission";
import {
  readSkillPermission,
  writeSkillPermission,
  SKILL_PERMISSION_EVENT,
  SKILL_PERMISSION_STORAGE_KEY,
  type SkillPermission,
} from "@/lib/skill-permission";
import {
  readDefaultModel,
  readDefaultModelEffort,
  readDefaultModelEffortFromServer,
  readDefaultModelFromServer,
  readLastUsedModel,
  writeDefaultModel,
  writeDefaultModelEffort,
  writeLastUsedModel,
} from "@/lib/default-model";
import { notifyTasksChanged } from "@/lib/events";
import {
  getJson,
  sendJson,
  timedFetch,
  IMAGE_ANALYSIS_SEND_TIMEOUT_MS,
  NEW_TASK_SEND_TIMEOUT_MS,
} from "@/lib/client";
import { prepareAttachedImage } from "@/lib/prepare-attached-image";
import { limitedProviderSet, readCodexBarAutoUsage } from "@/lib/codexbar-auto";
import {
  AUTO_MODEL_OPTION,
  AUTO_MODEL_VALUE,
  isAutoRouteConfigEmpty,
  type AutoDecision,
  type AutoOptimizeMode,
  type AutoProviderUsage,
  type AutoRouteConfig,
} from "@/lib/auto-model";
import {
  AUTO_OPTIMIZE_SETTING_KEY,
  AUTO_ROUTE_OVERRIDES_SETTING_KEY,
  hasStoredAutoSetting,
  readAutoOptimizeMode,
  readAutoRouteConfig,
  readAutoSettingsFromServer,
  subscribeAutoSetting,
  writeAutoOptimizeMode,
  writeAutoRouteConfig,
  writeAutoSettingToServer,
  type AutoSettingsSnapshot,
} from "@/lib/auto-settings";
import {
  AUTO_TASK_PROMPT_MAX,
  writeAutoTaskRecord,
  type AutoTaskRecord,
} from "@/lib/auto-task-record";
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
import {
  applySlashCompletion,
  filterCommands,
  parseSlashQuery,
} from "@/lib/slash-command";
import {
  applyAgentCompletion,
  filterAgents as filterAgentMentions,
  parseAtQuery,
  type AgentMention,
} from "@/lib/agent-mention";
import { useSlashCommands } from "@/lib/useSlashCommands";
import { useAgents } from "@/lib/useAgents";
import { NextTaskSuggest } from "@/components/home/NextTaskSuggest";
import { MobileMenuHeader } from "@/components/shell/MobileMenuHeader";
import { useMobileScrollTarget } from "@/components/shell/MobileScrollTargetContext";
import type { ProviderModelsDto } from "@/lib/extensions";
import { setModelPricingRegistry } from "@/lib/model-pricing-registry";
import {
  readProviderModelsCache,
  writeProviderModelsCache,
} from "@/lib/provider-models-cache";
import type { HealthDto, ProjectDto } from "@/lib/types";

type AgentResponse = {
  name: string;
  mode?: string;
  hidden?: boolean;
  model?: { providerID: string; modelID: string; variant?: string };
}[];

type Attachment = ComposerAttachment;

// HomeView は単一インスタンス（スコープ切替なし）なので、Map ではなく
// モジュールスコープ変数1つで十分。Home→Task→Home と遷移すると HomeView は
// アンマウント→リマウントされるため、入力中の prompt/attachments を保持する。
type HomeComposerDraft = { prompt: string; attachments: Attachment[] };
let homeComposerDraft: HomeComposerDraft | null = null;

function rememberHomeComposerDraft(draft: HomeComposerDraft) {
  homeComposerDraft = draft;
}

function readHomeComposerDraft(): HomeComposerDraft | null {
  return homeComposerDraft;
}

/** テスト専用: モジュールスコープの draft キャッシュをクリアする。 */
export function __clearHomeComposerDraftForTest() {
  homeComposerDraft = null;
}

const IMAGE_MIME_RE = /^image\//i;
// Match POST /api/tasks R28 / TaskView limits.
const MAX_IMAGE_COUNT = 10;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function estimateDataUrlBytes(uri: string): number {
  const comma = uri.indexOf(",");
  if (comma < 0) return Number.POSITIVE_INFINITY;
  const b64 = uri.slice(comma + 1);
  return Math.floor((b64.length * 3) / 4);
}

/** Poll interval for re-checking engine health while the "engine not connected"
 *  warning is shown. The initial /api/tasks fetch may report engineOk=false
 *  before OpenCode is fully up (just after the host opened the browser). Poll
 *  so the warning self-clears once the engine becomes reachable, without
 *  requiring a manual reload. Stops as soon as engineOk flips to true. */
const ENGINE_HEALTH_POLL_MS = 3000;

export function HomeView({ initialProjectId }: { initialProjectId?: string }) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [engineOk, setEngineOk] = useState(true);
  const [workflowModeEnabled, setWorkflowModeEnabled] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [isolation, setIsolation] = useState<"current_folder" | "git_worktree">(
    "current_folder",
  );
  const [prompt, setPrompt] = useState(() => readHomeComposerDraft()?.prompt ?? "");
  const [startMode, setStartMode] = useState<"task" | "workflow">("task");
  const [goalLoopEnabled, setGoalLoopEnabled] = useState(false);
  const [goalLoopAcceptance, setGoalLoopAcceptance] = useState("");
  const [goalLoopMaxTurns, setGoalLoopMaxTurns] = useState(10);
  const [goalLoopForceFullRun, setGoalLoopForceFullRun] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>(
    () => readHomeComposerDraft()?.attachments ?? [],
  );
  const attachmentsRef = useRef(attachments);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const {
    modelOptions,
    setModelOptions,
    modelLabels,
    modelCapabilities,
    setModelCapabilities,
    qwenNativeAvailable,
    setQwenNativeAvailable,
    agents,
    setAgents,
    agentModels,
    setAgentModels,
    model,
    setModel,
    serverDefaultModel,
    setServerDefaultModel,
    agent,
    setAgent,
    intelligence,
    setIntelligence,
    providerModelsMap,
    setProviderModelsMap,
  } = useModelConfigState();
  const modelTouchedRef = useRef(false);
  /**
   * Auto "Optimize For" policy. Seeded from localStorage during the first
   * render so the composer never flashes the wrong mode, then reconciled with
   * the server copy and kept in sync with the Settings screen.
   */
  const [autoOptimize, setAutoOptimize] = useState<AutoOptimizeMode>(() =>
    readAutoOptimizeMode(),
  );
  const [routeConfig, setRouteConfig] = useState<AutoRouteConfig>(() =>
    readAutoRouteConfig(),
  );
  const [codexBarUsage, setCodexBarUsage] = useState<
    AutoProviderUsage | undefined
  >(undefined);
  const [accessMode, setAccessMode] = useState<AccessMode>(() => readAccessMode());
  const [subagentPermission, setSubagentPermission] = useState<SubagentPermission>(
    () => readSubagentPermission(),
  );
  const [skillPermission, setSkillPermission] = useState<SkillPermission>(
    () => readSkillPermission(),
  );
  const [baseBranch, setBaseBranch] = useState("");
  const [branchProjectId, setBranchProjectId] = useState("");
  const [defaultBranchLabel, setDefaultBranchLabel] = useState("master");
  const [loaded, setLoaded] = useState(false);
  const projectsRequestRef = useRef(0);
  const engineRequestBusyRef = useRef(false);
  const mountedRef = useRef(false);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const [cursor, setCursor] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const voice = useVoiceInput({ disabled: submitting });
  const slashCommands = useSlashCommands();
  const agentMentions = useAgents();
  const slashQuery = useMemo(
    () => parseSlashQuery(prompt, cursor),
    [prompt, cursor],
  );
  const slashItems = useMemo(
    () =>
      slashQuery ? filterCommands(slashCommands, slashQuery.query) : [],
    [slashCommands, slashQuery],
  );
  const slashOpen = !slashDismissed && slashItems.length > 0;
  const atQuery = useMemo(
    () => (slashOpen ? null : parseAtQuery(prompt, cursor)),
    [prompt, cursor, slashOpen],
  );
  const mentionItems = useMemo(
    () => (atQuery ? filterAgentMentions(agentMentions, atQuery.query) : []),
    [agentMentions, atQuery],
  );
  const mentionOpen =
    !mentionDismissed && mentionItems.length > 0 && !slashOpen;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      projectsRequestRef.current += 1;
    };
  }, []);

  // 入力中の prompt/attachments をモジュールスコープへ保持する。
  // Home→Task→Home 遷移で HomeView がアンマウント→リマウントされても
  // 入力内容が消えないようにする（送信成功時は submit 内でクリア）。
  useEffect(() => {
    rememberHomeComposerDraft({ prompt, attachments });
  }, [prompt, attachments]);

  useEffect(() => {
    setSlashIndex(0);
    setSlashDismissed(false);
  }, [slashQuery?.query, slashQuery?.start]);

  useEffect(() => {
    setMentionIndex(0);
    setMentionDismissed(false);
  }, [atQuery?.query, atQuery?.start]);

  // Settings, TaskView, and the attention modal can change shared preferences
  // while Home remains mounted. Keep the values used by POST /api/tasks in
  // sync; otherwise the UI may show フルアクセス / 禁止 while the stale
  // request still sends ask / allow.
  useEffect(() => {
    const onAccessMode = (event: Event) => {
      const detail = (event as CustomEvent<AccessMode>).detail;
      if (detail === "ask" || detail === "full") setAccessMode(detail);
    };
    const onSubagentPermission = (event: Event) => {
      const detail = (event as CustomEvent<SubagentPermission>).detail;
      if (detail === "allow" || detail === "deny") {
        setSubagentPermission(detail);
      }
    };
    const onSkillPermission = (event: Event) => {
      const detail = (event as CustomEvent<SkillPermission>).detail;
      if (detail === "allow" || detail === "deny") setSkillPermission(detail);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === ACCESS_MODE_STORAGE_KEY) {
        if (event.newValue === "ask" || event.newValue === "full") {
          setAccessMode(event.newValue);
        } else if (event.newValue == null) {
          setAccessMode(readAccessMode());
        }
      }
      if (event.key === SUBAGENT_PERMISSION_STORAGE_KEY) {
        if (event.newValue === "allow" || event.newValue === "deny") {
          setSubagentPermission(event.newValue);
        } else if (event.newValue == null) {
          setSubagentPermission(readSubagentPermission());
        }
      }
      if (event.key === SKILL_PERMISSION_STORAGE_KEY) {
        if (event.newValue === "allow" || event.newValue === "deny") {
          setSkillPermission(event.newValue);
        } else if (event.newValue == null) {
          setSkillPermission(readSkillPermission());
        }
      }
    };
    window.addEventListener(ACCESS_MODE_EVENT, onAccessMode);
    window.addEventListener(SUBAGENT_PERMISSION_EVENT, onSubagentPermission);
    window.addEventListener(SKILL_PERMISSION_EVENT, onSkillPermission);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(ACCESS_MODE_EVENT, onAccessMode);
      window.removeEventListener(
        SUBAGENT_PERMISSION_EVENT,
        onSubagentPermission,
      );
      window.removeEventListener(SKILL_PERMISSION_EVENT, onSkillPermission);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // DB → localStorage migration so the default model set on another
  // browser/origin is restored here. Non-fatal: when the server is
  // unreachable or has no value, the existing localStorage copy (if any)
  // is left untouched and readDefaultModel() behaves as before.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const serverValue = await readDefaultModelFromServer().catch(() => null);
      if (!cancelled && mountedRef.current && serverValue) {
        setServerDefaultModel(serverValue);
        if (!readDefaultModel()) writeDefaultModel(serverValue);
        // Migrate the paired effort too; an existing local effort stays.
        const serverEffort = await readDefaultModelEffortFromServer().catch(
          () => null,
        );
        if (!cancelled && serverEffort && !readDefaultModelEffort()) {
          writeDefaultModelEffort(serverEffort);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Provider/config loading and server hydration race on a fresh origin. If
  // the fallback wins, apply the durable default once its option is available.
  useEffect(() => {
    if (modelTouchedRef.current || !serverDefaultModel) return;
    if (!modelOptions.some((option) => option.value === serverDefaultModel)) return;
    setModel((current) => (modelTouchedRef.current ? current : serverDefaultModel));
  }, [modelOptions, serverDefaultModel]);

  // Same DB → localStorage restore for the Auto settings. Only keys the server
  // actually has are applied, and only when localStorage has no copy yet, so a
  // local choice is never overwritten by a stale server value.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const snapshot: AutoSettingsSnapshot = await readAutoSettingsFromServer()
        .catch(() => ({}));
      if (
        !cancelled &&
        mountedRef.current &&
        snapshot.mode &&
        !hasStoredAutoSetting(AUTO_OPTIMIZE_SETTING_KEY)
      ) {
        writeAutoOptimizeMode(snapshot.mode);
        setAutoOptimize(snapshot.mode);
      }
      if (
        !cancelled &&
        mountedRef.current &&
        snapshot.routeConfig &&
        !hasStoredAutoSetting(AUTO_ROUTE_OVERRIDES_SETTING_KEY)
      ) {
        writeAutoRouteConfig(snapshot.routeConfig);
        setRouteConfig(snapshot.routeConfig);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Follow changes made in the Settings screen or another tab.
  useEffect(() => {
    const onMode = () => setAutoOptimize(readAutoOptimizeMode());
    return subscribeAutoSetting(AUTO_OPTIMIZE_SETTING_KEY, onMode);
  }, []);

  useEffect(() => {
    const onRouteConfig = () =>
      setRouteConfig(readAutoRouteConfig());
    return subscribeAutoSetting(
      AUTO_ROUTE_OVERRIDES_SETTING_KEY,
      onRouteConfig,
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void readCodexBarAutoUsage().then((usage) => {
      if (!cancelled && mountedRef.current) setCodexBarUsage(usage);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const changeAutoOptimize = useCallback((mode: AutoOptimizeMode) => {
    setAutoOptimize(mode);
    writeAutoOptimizeMode(mode);
    void writeAutoSettingToServer(AUTO_OPTIMIZE_SETTING_KEY, mode);
  }, []);

  const refreshProjects = useCallback(async (): Promise<boolean> => {
    const requestId = ++projectsRequestRef.current;
    setProjectsLoading(true);
    try {
      const data = await getJson<{ projects: ProjectDto[] }>("/api/projects");
      if (!mountedRef.current || requestId !== projectsRequestRef.current) return false;
      const nextProjects = data.projects ?? [];
      setProjects(nextProjects);
      setProjectId((cur) => {
        if (cur && nextProjects.some((project) => project.id === cur)) {
          return cur;
        }
        if (
          initialProjectId &&
          nextProjects.some((project) => project.id === initialProjectId)
        ) {
          return initialProjectId;
        }
        return nextProjects[0]?.id ?? "";
      });
      return true;
    } catch (err) {
      if (!mountedRef.current || requestId !== projectsRequestRef.current) return false;
      setError(err instanceof Error ? err.message : "プロジェクトを取得できませんでした");
      return false;
    } finally {
      if (mountedRef.current && requestId === projectsRequestRef.current) {
        setProjectsLoading(false);
      }
    }
  }, [initialProjectId]);

  const refreshEngine = useCallback(async () => {
    if (engineRequestBusyRef.current) return;
    engineRequestBusyRef.current = true;
    try {
      const data = await getJson<{ engineOk: boolean }>("/api/tasks");
      if (mountedRef.current) setEngineOk(data.engineOk);
    } catch {
      /* keep */
    } finally {
      engineRequestBusyRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await getJson<HealthDto>("/api/health");
        if (!cancelled && mountedRef.current) {
          setWorkflowModeEnabled(data.workflowModeEnabled === true);
        }
      } catch {
        /* workflow mode stays disabled on fetch failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    /**
     * Build the composer model options/capabilities/variant metadata and the
     * initial selection from a provider catalogue. Shared by the instant
     * paint (cached data, no config yet) and the fresh fetch (full data).
     */
    const applyProviderCatalogue = (
      providers: ProviderModelsDto[],
      configModel?: string,
    ) => {
      setModelPricingRegistry(providers);
      const options: ModelOption[] = [];
      const caps: Record<string, { attachment?: boolean; image?: boolean }> = {};
      const map: Record<string, ProviderModelMeta> = {};
      for (const p of providers) {
        if (p.enabled === false) continue;
        for (const m of p.models ?? []) {
          if (m.enabled === false) continue;
          const value = `${p.id}::${m.id}`;
          options.push({
            value,
            label: formatModelLabel(m.name, m.id),
            group: p.name || p.id,
            image:
              m.capabilities?.input?.image === true ||
              m.capabilities?.attachment === true,
          });
          caps[value] = {
            attachment: m.capabilities?.attachment === true,
            image: m.capabilities?.input?.image === true,
          };
          map[value] = {
            name: m.name,
            variants: m.variants,
          };
        }
      }
      const enabledOptions = filterEnabledModelOptions(options, providers);
      // Auto is inserted *after* filter/sort on purpose: providerSortKey
      // ("auto") is the unknown-provider tail value, so sorting would sink
      // it to the bottom. Prepending keeps the "Auto" group first in the
      // menu (groupedOptions preserves insertion order).
      const selectableOptions = [
        AUTO_MODEL_OPTION,
        ...sortModelOptions(
          enabledOptions,
          modelOrderPreferenceFromProviders(providers),
        ),
      ];
      setModelOptions(selectableOptions);
      setModelCapabilities(caps);
      setProviderModelsMap(map);

      // Prefer the user-configured default model, then the last actually-
      // used model, then OpenCode config.model (provider/modelID).
      // `"auto"` is part of selectableOptions, so a stored last-used Auto
      // restores through the same check. The provider-default fallback
      // that used to come from /api/opencode/provider's `default` map is
      // dropped: it was the last resort and the first enabled option
      // below is an equivalent final fallback.
      let initial = "";
      let fromDefault = false;
      const savedDefault = readDefaultModel();
      if (
        savedDefault &&
        selectableOptions.some((o) => o.value === savedDefault)
      ) {
        initial = savedDefault;
        fromDefault = true;
      }
      if (!initial) {
        const lastUsed = readLastUsedModel();
        if (
          lastUsed &&
          selectableOptions.some((o) => o.value === lastUsed)
        ) {
          initial = lastUsed;
        }
      }
      if (!initial && configModel) {
        const cfg = configModel.trim();
        if (cfg) {
          const slash = cfg.indexOf("/");
          if (slash > 0) {
            const value = `${cfg.slice(0, slash)}::${cfg.slice(slash + 1)}`;
            if (selectableOptions.some((o) => o.value === value)) initial = value;
          }
        }
      }
      // Never fall back to Auto: it stays an explicit manual choice.
      if (!initial && enabledOptions[0]) initial = enabledOptions[0].value;
      setModel((cur) => cur || initial);
      // Pair the default model with its configured effort (Settings →
      // プロバイダー/モデル). Seeded only when the model came from the
      // saved default; an invalid/unavailable effort is cleared by the
      // intelligence-variant guard effect below.
      if (fromDefault && initial !== AUTO_MODEL_OPTION.value) {
        const savedEffort = readDefaultModelEffort();
        if (isIntelligenceVariant(savedEffort)) {
          setIntelligence((cur) => cur || savedEffort);
        }
      }
    };

    // Instant paint: reuse the last-known catalogue while the fresh fetch is
    // in flight (the BFF can take seconds when the engine is cold or busy).
    // The fetch that follows immediately replaces it with fresh data.
    const cachedProviders = readProviderModelsCache();
    if (cachedProviders) applyProviderCatalogue(cachedProviders);

    void (async () => {
      try {
        const [configRes, agentRes, providerModelsRes, qwenStatusRes] = await Promise.all([
          timedFetch("/api/opencode/config"),
          timedFetch("/api/opencode/agent"),
          timedFetch("/api/extensions/provider-models"),
          timedFetch("/api/qwen-native/status").catch(() => undefined),
        ]);
        if (cancelled || !mountedRef.current) return;

        const qwenStatus = qwenStatusRes?.ok
          ? ((await qwenStatusRes.json().catch(() => ({}))) as {
              nativeAvailable?: unknown;
            })
          : null;
        setQwenNativeAvailable(qwenStatus?.nativeAvailable === true);

        const config = configRes.ok
          ? ((await configRes.json()) as { model?: string; agent?: unknown })
          : null;
        const providerModels = providerModelsRes.ok
          ? ((await providerModelsRes.json()) as { providers?: ProviderModelsDto[] })
          : null;

        // Build options, capabilities and variant metadata from the
        // /api/extensions/provider-models response alone. This used to fire a
        // separate /api/opencode/provider call in the same Promise.all; that
        // second call hit the same OpenCode /provider underneath and doubled
        // the Home boot latency. provider-models now forwards capabilities and
        // variants, so the raw provider response is no longer needed here.
        if (providerModels?.providers) {
          applyProviderCatalogue(providerModels.providers, config?.model);
          writeProviderModelsCache(providerModels.providers);
        }

        if (agentRes.ok) {
          const agentsData = (await agentRes.json()) as AgentResponse;
          if (cancelled || !mountedRef.current) return;
          const names = agentsData
            .filter((a) => a.mode !== "subagent" && !a.hidden)
            .map((a) => a.name);
          setAgents(names);
          const models: Record<
            string,
            { providerID: string; modelID: string; variant?: string }
          > = {};
          for (const item of agentsData) {
            if (item.name && item.model?.providerID && item.model.modelID) {
              models[item.name] = item.model;
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

          // Keep the configured agent usable while the provider catalogue is
          // still loading. The catalogue replaces this metadata when it
          // arrives, but the composer should not hide both selectors on boot.
          const fallbackModel = models[initial];
          if (fallbackModel) {
            const fallbackKey = `${fallbackModel.providerID}::${fallbackModel.modelID}`;
            setModelOptions((current) => {
              if (current.length > 0) return current;
              return [
                {
                  value: fallbackKey,
                  label: formatModelLabel(
                    fallbackModel.modelID,
                    fallbackModel.modelID,
                  ),
                  group: fallbackModel.providerID,
                },
              ];
            });
            setModel((current) => current || fallbackKey);
            const fallbackVariant = fallbackModel.variant;
            if (isIntelligenceVariant(fallbackVariant)) {
              setProviderModelsMap((current) => ({
                ...current,
                [fallbackKey]: {
                  name: fallbackModel.modelID,
                  variants: { [fallbackVariant]: {} },
                },
              }));
            }
          }
        }
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void Promise.all([refreshProjects(), refreshEngine()]).finally(() =>
      mountedRef.current && setLoaded(true),
    );
  }, [refreshProjects, refreshEngine]);

  // Track page visibility so background tabs stop polling (mirrors Sidebar).
  useEffect(() => {
    const onVisible = () => {
      const visible = document.visibilityState === "visible";
      setPageVisible(visible);
      if (visible) void refreshEngine();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshEngine]);

  // Re-check engine health while the "engine not connected" warning is shown
  // so it self-clears once OpenCode becomes reachable (no manual reload needed).
  // Paused while the tab is hidden to avoid pointless background fetches.
  useEffect(() => {
    if (!pageVisible || engineOk) return;
    const id = setInterval(() => {
      void refreshEngine();
    }, ENGINE_HEALTH_POLL_MS);
    return () => clearInterval(id);
  }, [engineOk, pageVisible, refreshEngine]);

  useEffect(() => {
    const project = projects.find((p) => p.id === projectId);
    let cancelled = false;
    setBaseBranch("");
    setBranchProjectId("");
    if (!project?.rootPath) {
      setDefaultBranchLabel("master");
      return () => {
        cancelled = true;
      };
    }
    setDefaultBranchLabel("読み込み中…");
    void (async () => {
      try {
        const info = await getJson<{
          branches: string[];
          defaultTarget: string | null;
          current: string;
        }>("/api/git/branches", { directory: project.rootPath });
        const branches = info.branches ?? [];
        const preferred =
          info.defaultTarget ||
          (branches.includes("master")
            ? "master"
            : branches.includes("main")
              ? "main"
              : info.current) ||
          "master";
        if (cancelled) return;
        setDefaultBranchLabel(preferred);
        setBaseBranch(preferred);
      } catch {
        if (cancelled) return;
        // Omitting baseBranch makes git use this repository's current HEAD,
        // which is safer than guessing "master" for a main/develop repository.
        setBaseBranch("");
        setDefaultBranchLabel("現在の HEAD");
      } finally {
        if (!cancelled) setBranchProjectId(project.id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, projects]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, []);

  const onVoiceTranscript = useCallback(
    (text: string) => {
      if (text) {
        setPrompt((prev) => {
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
        autoResize();
      });
    },
    [autoResize],
  );

  const syncCursor = useCallback(() => {
    const el = textareaRef.current;
    if (el) setCursor(el.selectionStart ?? 0);
  }, []);

  /**
   * Write an accepted next-task proposal into the composer. Mirrors
   * TaskView's restoreToComposer: the text replaces the current prompt and
   * the caret moves to the end. Never submits — starting the task stays an
   * explicit user action.
   */
  const applySuggestion = useCallback(
    (suggestion: string) => {
      setPrompt(suggestion);
      setCursor(suggestion.length);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(suggestion.length, suggestion.length);
        autoResize();
      });
    },
    [autoResize],
  );

  const applySlash = useCallback(
    (name: string) => {
      const query = parseSlashQuery(prompt, cursor);
      if (!query) return;
      const next = applySlashCompletion(prompt, query, name);
      setPrompt(next.text);
      setCursor(next.cursor);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(next.cursor, next.cursor);
        autoResize();
      });
    },
    [prompt, cursor, autoResize],
  );

  const applyAgentMention = useCallback(
    (agent: AgentMention) => {
      const query = parseAtQuery(prompt, cursor);
      if (!query) return;
      const next = applyAgentCompletion(prompt, query, agent.name);
      setPrompt(next.text);
      setCursor(next.cursor);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(next.cursor, next.cursor);
        autoResize();
      });
    },
    [prompt, cursor, autoResize],
  );

  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedModel = modelOptions.find((option) => option.value === model);

  const submit = useCallback(async () => {
    const text = prompt.trim();
    const branchReady =
      isolation !== "git_worktree" || branchProjectId === projectId;
    if (
      (!text && attachments.length === 0) ||
      !projectId ||
      submitting ||
      submittingRef.current ||
      !engineOk ||
      !branchReady
    ) {
      return;
    }
    // Workflow conversion requires a non-empty goal string. Image-only
    // submissions would create a task (and may burn VL pre-analysis time)
    // then fail with "goal is required" and delete the task.
    if (startMode === "workflow" && workflowModeEnabled && !text) {
      setError("Workflow で開始するには目標テキストが必要です。");
      return;
    }
    // Goal Loop needs a non-empty text goal and cannot carry attachments
    // (same contract as TaskView startGoalLoop). Otherwise POST /api/tasks
    // succeeds and the follow-up /goal-loop fails with "invalid goal",
    // leaving an orphaned task (unlike Workflow, which DELETEs on failure).
    if (goalLoopEnabled && startMode === "task") {
      if (attachments.length > 0) {
        setError(
          "ループでは添付ファイルを利用できません。添付を削除してから開始してください。",
        );
        return;
      }
      if (!text) {
        setError("ゴールループで開始するには目標テキストが必要です。");
        return;
      }
    }
    // Match the engine's model precedence: the explicit manual selection
    // serves when present; the agent's pinned model applies only when no
    // manual model is selected (same as TaskView / BFF image capability
    // checks).
    const agentModel = agent ? agentModels[agent] : undefined;
    const sendingModelKey =
      model && model !== AUTO_MODEL_VALUE
        ? model
        : agentModel
          ? `${agentModel.providerID}::${agentModel.modelID}`
          : model || "";
    const sendingImageSupported =
      sendingModelKey === AUTO_MODEL_VALUE
        ? // Auto has no capabilities of its own: pass when at least one
          // connected model could take the image and let the server make the
          // final call (it selects only from image-capable candidates).
          Object.values(modelCapabilities).some(
            (capability) =>
              capability.image === true || capability.attachment === true,
          )
        : sendingModelKey
          ? modelCapabilities[sendingModelKey]?.image === true ||
            modelCapabilities[sendingModelKey]?.attachment === true
          : false;
    const hasImage = attachments.some((a) => IMAGE_MIME_RE.test(a.mime));
    const sendingImageBlocked = hasImage && !sendingImageSupported && !qwenNativeAvailable;
    if (sendingImageBlocked) {
      setError(
        "選択中のモデルは画像入力に対応していないか、画像事前解析も有効ではありません。画像対応モデルを選ぶか、設定の「モデル」タブで画像事前解析モデルを選択してください。",
      );
      return;
    }
    if (attachments.length > MAX_IMAGE_COUNT) {
      setError(`画像は最大 ${MAX_IMAGE_COUNT} 枚まで添付できます。`);
      return;
    }
    if (
      attachments.some((a) => estimateDataUrlBytes(a.uri) > MAX_IMAGE_SIZE_BYTES)
    ) {
      setError(
        `各画像は ${Math.floor(MAX_IMAGE_SIZE_BYTES / (1024 * 1024))} MB 以下にしてください。`,
      );
      return;
    }
    const requestBaseBranch =
      isolation === "git_worktree" && branchProjectId === projectId
        ? baseBranch
        : "";
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    let createdTaskId: string | null = null;
    try {
      // `"auto".split("::")` yields `["auto"]`, so modelID stays undefined and
      // the `model` field below is omitted for Auto without a special case.
      const [providerID, modelID] = model ? model.split("::") : [];
      const isAuto = model === AUTO_MODEL_VALUE;
      // Default sendJson timeout (30s) aborts during VL pre-analysis / large
      // base64 upload long before the analysis model finishes (default 120s).
      const data = await sendJson<{
        taskId: string;
        sessionId: string;
        autoDecision?: AutoDecision;
      }>(
        "POST",
        "/api/tasks",
        {
          projectId,
          prompt: text,
          isolation,
          ...(attachments.length > 0
            ? {
                files: attachments.map(({ uri, mime, name }) => ({
                  uri,
                  mime,
                  ...(name ? { name } : {}),
                })),
              }
            : {}),
          ...(requestBaseBranch ? { baseBranch: requestBaseBranch } : {}),
          ...(providerID && modelID ? { model: { providerID, modelID } } : {}),
          ...(isAuto
            ? {
                auto: true,
                autoOptimize,
                ...(codexBarUsage ? { codexBarUsage } : {}),
                ...(!isAutoRouteConfigEmpty(routeConfig)
                  ? { autoRouteOverrides: routeConfig }
                  : {}),
              }
            : {}),
          // subagentPermission must be sent even when no agent is selected:
          // enforcement is session-scoped (not agent-scoped), so omitting it
          // whenever `agent` is empty left "禁止" without effect on the new
          // session's first prompt.
          subagentPermission,
          skillPermission,
          // 確認する is not self-enforcing: OpenCode allows `edit` by default, so
          // the mode has to be pushed to the new session as an `edit` ruleset or
          // the first prompt writes files with no approval card.
          accessMode,
          ...(agent ? { agent } : {}),
          // Auto decides the effort server-side and the API rejects both being
          // set. `intelligence` is normally "" for Auto, but an agent-scoped
          // variant can survive, so drop it explicitly.
          ...(intelligence && !isAuto ? { variant: intelligence } : {}),
        },
        undefined,
        {
          timeoutMs:
            attachments.length > 0
              ? IMAGE_ANALYSIS_SEND_TIMEOUT_MS
              : NEW_TASK_SEND_TIMEOUT_MS,
        },
      );
      createdTaskId = data.taskId;
      if (startMode === "workflow" && workflowModeEnabled) {
        const current = await getJson<{ workflow: { workspaceRevision: number } }>(
          `/api/tasks/${encodeURIComponent(data.taskId)}/workflow`,
        );
        await sendJson("POST", `/api/tasks/${encodeURIComponent(data.taskId)}/workflow`, {
          workspaceRevision: current.workflow.workspaceRevision,
          goal: text,
          acceptance: [],
          constraints: [],
        });
      }
      const decision = data.autoDecision;
      if (goalLoopEnabled && startMode === "task") {
        // The loop runs server-side later, so it needs the resolved model
        // rather than the literal "auto" sentinel.
        const loopModel = decision
          ? { providerID: decision.providerID, modelID: decision.modelID }
          : providerID && modelID
            ? { providerID, modelID }
            : undefined;
        const loopVariant = decision
          ? decision.variant
          : isAuto
            ? ""
            : intelligence;
        await sendJson("POST", `/api/tasks/${data.taskId}/goal-loop`, {
          sessionId: data.sessionId,
          goal: text,
          acceptance: goalLoopAcceptance
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean),
          maxTurns: goalLoopMaxTurns,
          forceFullRun: goalLoopForceFullRun,
          ...(loopModel ? { model: loopModel } : {}),
          ...(agent ? { agent } : {}),
          ...(loopVariant ? { variant: loopVariant } : {}),
        });
      }
      // Hand the decision to TaskView for the chip and the one-shot retry.
      // The prompt is omitted (retry disabled) for oversized prompts and for
      // image submissions, which cannot be replayed faithfully.
      if (decision) {
        const record: AutoTaskRecord = {
          decision,
          ...(text && text.length <= AUTO_TASK_PROMPT_MAX && attachments.length === 0
            ? { prompt: text }
            : {}),
          ...(agent ? { agent } : {}),
        };
        // Failure only costs the chip / retry, never the submission itself.
        writeAutoTaskRecord(data.taskId, record);
      }
      // Remember the model actually applied to this submission so the next
      // new session preselects it.
      writeLastUsedModel(sendingModelKey || null);
      notifyTasksChanged();
      // 送信成功: キャッシュをクリアしてからアンマウントする。
      // 画面はこの直後 router.push で TaskView へ遷移するため、
      // setPrompt("") 等のローカル state 更新は不要。
      rememberHomeComposerDraft({ prompt: "", attachments: [] });
      router.push(`/task/${data.taskId}`);
    } catch (err) {
      if (
        createdTaskId &&
        ((startMode === "workflow" && workflowModeEnabled) ||
          (goalLoopEnabled && startMode === "task"))
      ) {
        try {
          await sendJson("DELETE", `/api/tasks/${encodeURIComponent(createdTaskId)}`);
        } catch {
          // Keep the original initialization error visible; the TaskView menu can retry conversion.
        }
      }
      submittingRef.current = false;
      setError(err instanceof Error ? err.message : "タスク作成に失敗しました");
      setSubmitting(false);
    }
  }, [
    prompt,
    attachments,
    projectId,
    isolation,
    branchProjectId,
    baseBranch,
    model,
    modelCapabilities,
    qwenNativeAvailable,
    agent,
    agentModels,
    intelligence,
    autoOptimize,
    routeConfig,
    codexBarUsage,
    goalLoopEnabled,
    goalLoopAcceptance,
    goalLoopMaxTurns,
    goalLoopForceFullRun,
    startMode,
    subagentPermission,
    skillPermission,
    accessMode,
    submitting,
    engineOk,
    workflowModeEnabled,
    router,
  ]);

  // If the workflow feature is disabled while the composer still shows the
  // Workflow start mode, snap back to Task so the submit handler never sends
  // a workflow request against a disabled feature.
  useEffect(() => {
    if (!workflowModeEnabled && startMode === "workflow") setStartMode("task");
  }, [workflowModeEnabled, startMode]);

  // No live session exists on Home, and a session-scoped ruleset is the only
  // enforcement OpenCode actually honours at runtime. So store the preference
  // here and let POST /api/tasks apply it to the new session at creation time.
  const changeSubagentPermission = useCallback((mode: SubagentPermission) => {
    setSubagentPermission(mode);
    writeSubagentPermission(mode);
  }, []);

  const changeSkillPermission = useCallback((mode: SkillPermission) => {
    setSkillPermission(mode);
    writeSkillPermission(mode);
  }, []);

  // Calculate intelligence variants based on the effective model (manual
  // selection wins; the agent's model applies only when no manual model is
  // chosen). The engine serves the explicit request model when both are sent.
  const effectiveModelKey = useMemo(() => {
    if (model && model !== AUTO_MODEL_VALUE) return model;
    if (agent) {
      const agentModel = agentModels[agent];
      if (agentModel) return `${agentModel.providerID}::${agentModel.modelID}`;
    }
    return model;
  }, [agent, agentModels, model]);

  // Match TaskView / submit(): Auto is attachment-usable when any connected
  // model supports images (Auto itself has no capability flags).
  const selectedModelSupportsImage =
    effectiveModelKey === AUTO_MODEL_VALUE
      ? Object.values(modelCapabilities).some(
          (capability) =>
            capability.image === true || capability.attachment === true,
        )
      : effectiveModelKey
        ? modelCapabilities[effectiveModelKey]?.image === true ||
          modelCapabilities[effectiveModelKey]?.attachment === true ||
          modelOptions.find((option) => option.value === effectiveModelKey)
            ?.image === true
        : false;
  const selectedModelCanUseImage = selectedModelSupportsImage || qwenNativeAvailable;

  const addImageFiles = useCallback(async (files: FileList | File[]) => {
    if (!selectedModelCanUseImage) {
      setError(
        "選択中のモデルは画像入力に対応していないか、画像事前解析も有効ではありません。画像対応モデルを選ぶか、設定の「モデル」タブで画像事前解析モデルを選択してください。",
      );
      return;
    }
    const list = Array.from(files).filter((file) => IMAGE_MIME_RE.test(file.type));
    if (list.length === 0) return;

    const candidates: Attachment[] = [];
    let rejected = 0;
    for (const file of list) {
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        rejected += 1;
        continue;
      }
      try {
        const prepared = await prepareAttachedImage(file);
        if (estimateDataUrlBytes(prepared.uri) > MAX_IMAGE_SIZE_BYTES) {
          rejected += 1;
          continue;
        }
        candidates.push(prepared);
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

    const skipped = rejected + (candidates.length - appended);
    if (skipped > 0) {
      setError(
        `一部の画像をスキップしました（上限 ${MAX_IMAGE_COUNT} 枚 / ${Math.floor(MAX_IMAGE_SIZE_BYTES / (1024 * 1024))} MB）。`,
      );
    }
  }, [selectedModelCanUseImage]);

  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (submitting) return;
      const imageFiles = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file" && IMAGE_MIME_RE.test(item.type))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (imageFiles.length > 0) {
        event.preventDefault();
        void addImageFiles(imageFiles);
      }
    },
    [addImageFiles, submitting],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (submitting || !event.dataTransfer?.files?.length) return;
      event.preventDefault();
      void addImageFiles(event.dataTransfer.files);
    },
    [addImageFiles, submitting],
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
  }, []);

  const removeAttachment = useCallback((index: number) => {
    const next = attachmentsRef.current.filter(
      (_, currentIndex) => currentIndex !== index,
    );
    attachmentsRef.current = next;
    setAttachments(next);
  }, []);

  const intelligenceVariants = useMemo(() => {
    if (!effectiveModelKey) return [];
    const modelMeta = providerModelsMap[effectiveModelKey];
    if (!modelMeta) return [];
    return getIntelligenceVariants(modelMeta);
  }, [effectiveModelKey, providerModelsMap]);

  // CodexBar の使用率スナップショットから、レートリミット到達プロバイダを抽出。
  // モールドロップダウンで該当モデルを赤字表示するために ModelSelect へ渡す。
  const modelLimitedProviders = useMemo(
    () => limitedProviderSet(codexBarUsage),
    [codexBarUsage],
  );

  useEffect(() => {
    if (!intelligence) return;
    if (!intelligenceVariants.some((v) => v === intelligence)) {
      setIntelligence("");
    }
  }, [intelligence, intelligenceVariants]);

  const setScrollTarget = useMobileScrollTarget();

  return (
    <div className="flex h-full flex-col">
      <MobileMenuHeader />
      <div
        ref={setScrollTarget}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-clip"
      >
      <main
        className={cx(
          "mx-auto flex min-h-full max-w-5xl flex-col justify-center px-4 py-12 pb-[max(6rem,env(safe-area-inset-bottom))]",
          (slashOpen || mentionOpen) && "pt-64",
        )}
      >
        <section>
          <h1 className="mb-6 flex items-center justify-center gap-2 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon-192.png"
              alt=""
              width={28}
              height={28}
              className="h-7 w-7 shrink-0 rounded-[6px] object-contain sm:h-8 sm:w-8"
            />
            <span>LeafCode</span>
          </h1>
          <div className="mx-auto mb-3 flex max-w-5xl items-center justify-start gap-2 overflow-x-auto px-1 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <GhostSelect
              value={projectId}
              disabled={submitting || projectsLoading}
              aria-label="プロジェクト"
              icon={<FolderGit2 className="h-3.5 w-3.5" />}
              valueLabel={
                projectsLoading
                  ? "読み込み中…"
                  : selectedProject
                    ? `${selectedProject.favorite ? "★ " : ""}${selectedProject.name}`
                    : "プロジェクトなし"
              }
              onChange={setProjectId}
              className="max-w-[12rem] shrink-0 sm:max-w-56"
              title={
                selectedProject
                  ? `${selectedProject.favorite ? "★ " : ""}${selectedProject.name}`
                  : "プロジェクトなし"
              }
              action={
                <AddProjectButton
                  label="プロジェクトを追加"
                  buttonVariant="ghost"
                  buttonSize="sm"
                  className="w-full"
                  onAdded={(project) => {
                    void refreshProjects().then((refreshed) => {
                      if (refreshed) setProjectId(project.id);
                    });
                  }}
                />
              }
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.favorite ? "★ " : ""}
                  {p.name}
                </option>
              ))}
            </GhostSelect>
            <GhostSelect
              value={isolation}
              disabled={submitting}
              aria-label="作業場所"
              icon={<GitBranch className="h-3.5 w-3.5" />}
              valueLabel={
                isolation === "current_folder" ? defaultBranchLabel : "worktree"
              }
              onChange={(value) =>
                setIsolation(
                  value as "current_folder" | "git_worktree",
                )
              }
              className="max-w-[10rem] shrink-0 sm:max-w-40"
              title="master: 現在ブランチで作業 / worktree: 分離ブランチ"
            >
              <option value="current_folder">{defaultBranchLabel}</option>
              <option value="git_worktree">worktree</option>
            </GhostSelect>
            {workflowModeEnabled && (
              <GhostSelect
                value={startMode}
                disabled={submitting}
                aria-label="開始モード"
                icon={<Play className="h-3.5 w-3.5" />}
                valueLabel={startMode === "task" ? "Taskで開始" : "Workflowで開始"}
                onChange={(value) => {
                  if (value === "task" || value === "workflow") {
                    setStartMode(value);
                    // Goal loop and Workflow are mutually exclusive: the loop
                    // toggle is hidden in Workflow mode and a stale ON state
                    // would silently ignore the loop settings at submit (BU-1).
                    if (value === "workflow") setGoalLoopEnabled(false);
                  }
                }}
                className="max-w-[11rem] shrink-0 sm:max-w-44"
                title={
                  startMode === "task"
                    ? "通常のTaskとして開始"
                    : "Implement → Reviewの固定フロー"
                }
              >
                <option value="task" title="通常のTaskとして開始">Taskで開始</option>
                <option value="workflow" title="Implement → Reviewの固定フロー">Workflowで開始</option>
              </GhostSelect>
            )}
          </div>
          <Composer
            form={{
              ariaLabel: "タスク作成",
              onSubmit: (event) => {
                event.preventDefault();
                void submit();
              },
            }}
            className="relative mx-auto max-w-5xl rounded-2xl border border-border bg-bg px-3 py-2 shadow-sm focus-within:border-border-strong focus-within:ring-2 focus-within:ring-primary/20"
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
            commands={slashCommands}
            agents={agentMentions}
            mention={
              mentionOpen
                ? {
                    items: mentionItems,
                    activeIndex: mentionIndex,
                    onHover: setMentionIndex,
                    onSelect: (agent) => applyAgentMention(agent),
                  }
                : undefined
            }
            attachments={attachments}
            onRemoveAttachment={removeAttachment}
            attachmentRemovalDisabled={submitting}
            attachmentRemovalLabel={(attachment) =>
              `${attachment.name ?? "添付画像"}を削除`
            }
            textarea={{
              ref: textareaRef,
              value: prompt,
              rows: 2,
              style: { fontSize: "16px", textSizeAdjust: "100%", WebkitTextSizeAdjust: "100%" },
              ariaLabel: "タスクの説明",
              busy: submitting,
              readOnly: submitting,
              onChange: (event) => {
                setPrompt(event.target.value);
                setCursor(event.target.selectionStart ?? event.target.value.length);
                autoResize();
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
                if (mentionOpen && !composingRef.current) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setMentionIndex((i) => (i + 1) % mentionItems.length);
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setMentionIndex((i) => (i - 1 + mentionItems.length) % mentionItems.length);
                    return;
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    const item = mentionItems[mentionIndex];
                    if (item) applyAgentMention(item);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setMentionDismissed(true);
                    return;
                  }
                }
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !composingRef.current) {
                  event.preventDefault();
                  void submit();
                }
              },
              placeholder: "タスクを説明してください…（Ctrl+Enter で開始）",
              className: "w-full resize-none bg-transparent py-1.5 text-base outline-none focus-visible:outline-none placeholder:text-faint",
            }}
            afterTextarea={
              goalLoopEnabled && startMode === "task" ? (
                <GoalLoopOptions
                  acceptance={goalLoopAcceptance}
                  maxTurns={goalLoopMaxTurns}
                  forceFullRun={goalLoopForceFullRun}
                  disabled={submitting}
                  onAcceptanceChange={setGoalLoopAcceptance}
                  onMaxTurnsChange={setGoalLoopMaxTurns}
                  onForceFullRunChange={setGoalLoopForceFullRun}
                />
              ) : undefined
            }
            attachmentControl={{
              inputRef: fileInputRef,
              inputDisabled: submitting,
              inputAriaLabel: "画像ファイルを選択",
              buttonDisabled: submitting || !selectedModelCanUseImage,
              buttonTitle: selectedModelCanUseImage
                ? "画像を添付"
                : "選択中のモデルは画像入力に対応していません",
              buttonClassName: "flex h-8 shrink-0 items-center justify-center rounded-lg border border-border bg-bg px-2 text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40",
              onFilesSelected: (files) => void addImageFiles(files),
              onTrigger: () => {
                if (selectedModelCanUseImage) fileInputRef.current?.click();
              },
            }}
            toolbar={<>
                <VoiceInputButton
                  voice={voice}
                  onTranscript={onVoiceTranscript}
                  onNativeVoiceStart={() => textareaRef.current?.focus()}
                  disabled={submitting}
                />
                {modelOptions.length > 0 && (
                  <ModelSelect
                    value={model}
                    disabled={submitting}
                    options={modelOptions}
                    onChange={(value) => {
                      modelTouchedRef.current = true;
                      setModel(value);
                      setIntelligence("");
                    }}
                    className="max-w-[11rem] shrink-0 sm:max-w-48"
                    title={selectedModel?.label ?? "モデル"}
                    limitedProviders={modelLimitedProviders}
                    imageAnalysisAvailable={qwenNativeAvailable}
                  />
                )}
                {model !== AUTO_MODEL_VALUE && intelligenceVariants.length > 0 && (
                  <IntelligenceSelect
                    variants={intelligenceVariants}
                    value={intelligence}
                    onChange={(v) =>
                      setIntelligence(isIntelligenceVariant(v) ? v : "")
                    }
                    disabled={submitting}
                  />
                )}
                {/* Auto を選んでいる間の effort は Auto 側に委ねる。
                    エージェントがモデルを固定していても（Auto ルーティングが
                    バイパスされる場合でも）IntelligenceSelect は出さず、
                    AutoOptimizeSelect だけを表示する。 */}
                {model === AUTO_MODEL_VALUE && (
                  <AutoOptimizeSelect
                    value={autoOptimize}
                    onChange={changeAutoOptimize}
                    disabled={submitting}
                  />
                )}
                {agents.length > 0 && (
                  <GhostSelect
                    value={agent}
                    disabled={submitting}
                    aria-label="エージェント"
                    icon={<Bot className="h-3.5 w-3.5" />}
                    valueLabel={agent || "エージェント"}
                    onChange={(value) => {
                      setAgent(value);
                      setIntelligence("");
                    }}
                    className="max-w-[10rem] shrink-0 sm:max-w-40"
                    title={agent || "エージェント"}
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
                  disabled={submitting}
                  onChange={(m) => {
                    setAccessMode(m);
                    writeAccessMode(m);
                  }}
                  className="h-8 shrink-0"
                />
                <SkillPermissionSelect
                  value={skillPermission}
                  disabled={submitting}
                  onChange={(m) => changeSkillPermission(m)}
                  className="h-8 shrink-0"
                />
                <SubagentPermissionSelect
                  value={subagentPermission}
                  disabled={submitting}
                  onChange={(m) => changeSubagentPermission(m)}
                  className="h-8 shrink-0"
                />
                {startMode === "task" && (
                  <GoalLoopToggle
                    enabled={goalLoopEnabled}
                    disabled={submitting}
                    onToggle={() => setGoalLoopEnabled((v) => !v)}
                  />
                )}
              </>}
            action={<Button
                variant="primary"
                size="icon"
                type="submit"
                aria-label="タスク開始"
                className="shrink-0"
                busy={submitting}
                disabled={
                  (!prompt.trim() && attachments.length === 0) ||
                  (startMode === "workflow" &&
                    workflowModeEnabled &&
                    !prompt.trim()) ||
                  (goalLoopEnabled &&
                    startMode === "task" &&
                    (!prompt.trim() || attachments.length > 0)) ||
                  !projectId ||
                  submitting ||
                  !engineOk ||
                  (isolation === "git_worktree" &&
                    branchProjectId !== projectId)
                }
              >
                {!submitting && <ArrowUp className="h-4.5 w-4.5" />}
              </Button>}
          />

          <NextTaskSuggest
            projectId={projectId}
            model={model || undefined}
            agent={agent || undefined}
            disabled={submitting || !engineOk}
            onApply={applySuggestion}
          />

          {loaded && !engineOk && (
            <p className="mx-auto mt-3 max-w-2xl rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
              エンジン未接続。設定またはトレイから OpenCode を再起動してください。
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="mx-auto mt-3 max-w-2xl break-all rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          )}
        </section>
      </main>
      </div>
    </div>
  );
}
