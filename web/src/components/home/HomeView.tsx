"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Bot, FolderGit2, GitBranch, Paperclip, X } from "lucide-react";
import { AccessModeSelect } from "@/components/AccessModeSelect";
import { SubagentPermissionSelect } from "@/components/SubagentPermissionSelect";
import { AddProjectButton } from "@/components/AddProjectButton";
import { IntelligenceSelect } from "@/components/IntelligenceSelect";
import { ModelSelect } from "@/components/ModelSelect";
import { SlashSuggestMenu } from "@/components/SlashSuggestMenu";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { Button, GhostSelect, cx } from "@/components/ui";
import { useVoiceInput } from "@/lib/use-voice-input";
import {
  readAccessMode,
  writeAccessMode,
  type AccessMode,
} from "@/lib/access-mode";
import {
  readSubagentPermission,
  writeSubagentPermission,
  type SubagentPermission,
} from "@/lib/subagent-permission";
import {
  readDefaultModel,
  readDefaultModelFromServer,
  readLastUsedModel,
  writeDefaultModel,
  writeLastUsedModel,
} from "@/lib/default-model";
import { notifyTasksChanged } from "@/lib/events";
import { getJson, sendJson, timedFetch } from "@/lib/client";
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
import {
  applySlashCompletion,
  filterCommands,
  parseSlashQuery,
} from "@/lib/slash-command";
import { useSlashCommands } from "@/lib/useSlashCommands";
import { MobileMenuHeader } from "@/components/shell/MobileMenuHeader";
import type { ProjectDto } from "@/lib/types";

type ProviderResponse = {
  all: {
    id: string;
    name: string;
    models: Record<
      string,
      {
        name?: string;
        // OpenCode's live GET /provider response nests capability flags
        // under `capabilities` (see opencode-schema.d.ts `Model.capabilities`),
        // not top-level `attachment`/`modalities.input[]` (that shape is only
        // the *config* override schema for opencode.jsonc
        // `provider.<id>.models.<id>`). Reading the old shape here always
        // yields `undefined`, so every model was reported as
        // image-unsupported regardless of real capability.
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
  model?: { providerID: string; modelID: string };
}[];

type Attachment = { uri: string; mime: string; name?: string; preview?: string };

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
  const [engineOk, setEngineOk] = useState(true);
  const [projectId, setProjectId] = useState("");
  const [isolation, setIsolation] = useState<"current_folder" | "git_worktree">(
    "current_folder",
  );
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelCapabilities, setModelCapabilities] = useState<
    Record<string, { attachment?: boolean; image?: boolean }>
  >({});
  const [agents, setAgents] = useState<string[]>([]);
  const [agentModels, setAgentModels] = useState<
    Record<string, { providerID: string; modelID: string }>
  >({});
  const [model, setModel] = useState("");
  const [agent, setAgent] = useState("");
  const [intelligence, setIntelligence] = useState<IntelligenceVariant | "">("");
  const [providerModelsMap, setProviderModelsMap] = useState<
    Record<string, ProviderModelMeta>
  >({});
  const [accessMode, setAccessMode] = useState<AccessMode>("ask");
  const [subagentPermission, setSubagentPermission] =
    useState<SubagentPermission>("allow");
  const [baseBranch, setBaseBranch] = useState("");
  const [branchProjectId, setBranchProjectId] = useState("");
  const [defaultBranchLabel, setDefaultBranchLabel] = useState("master");
  const [loaded, setLoaded] = useState(false);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const [cursor, setCursor] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const voice = useVoiceInput({ disabled: submitting });
  const slashCommands = useSlashCommands();
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

  useEffect(() => {
    setSlashIndex(0);
    setSlashDismissed(false);
  }, [slashQuery?.query, slashQuery?.start]);

  useEffect(() => {
    setAccessMode(readAccessMode());
    setSubagentPermission(readSubagentPermission());
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

  const refreshProjects = useCallback(async () => {
    try {
      const data = await getJson<{ projects: ProjectDto[] }>("/api/projects");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "projects failed");
    }
  }, [initialProjectId]);

  const refreshEngine = useCallback(async () => {
    try {
      const data = await getJson<{ engineOk: boolean }>("/api/tasks");
      setEngineOk(data.engineOk);
    } catch {
      /* keep */
    }
  }, []);

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
              map[value] = {
                name: m.name,
                variants: m.variants,
              };
            }
          }
          setModelOptions(sortModelOptions(options));
          setModelCapabilities(caps);
          setProviderModelsMap(map);

          // Prefer the last actually-used model, then the user-configured
          // default model, then OpenCode config.model (provider/modelID),
          // then provider defaults.
          let initial = "";
          const lastUsed = readLastUsedModel();
          if (lastUsed && options.some((o) => o.value === lastUsed)) {
            initial = lastUsed;
          }
          if (!initial) {
            const savedDefault = readDefaultModel();
            if (
              savedDefault &&
              options.some((o) => o.value === savedDefault)
            ) {
              initial = savedDefault;
            }
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
        }
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

  useEffect(() => {
    void Promise.all([refreshProjects(), refreshEngine()]).finally(() =>
      setLoaded(true),
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
      !engineOk ||
      !branchReady
    ) {
      return;
    }
    // Match OpenCode's agent precedence: configured agent model overrides the
    // manual selector; when the agent has no model, fall back to the request
    // model (same as TaskView / BFF image capability checks).
    const agentModel = agent ? agentModels[agent] : undefined;
    const sendingModelKey = agentModel
      ? `${agentModel.providerID}::${agentModel.modelID}`
      : model || "";
    const sendingImageSupported = sendingModelKey
      ? modelCapabilities[sendingModelKey]?.image === true ||
        modelCapabilities[sendingModelKey]?.attachment === true
      : false;
    const hasImage = attachments.some((a) => IMAGE_MIME_RE.test(a.mime));
    const sendingImageBlocked = hasImage && !sendingImageSupported;
    if (sendingImageBlocked) {
      setError(
        "選択中のモデルは画像入力に対応していないか、画像対応を確認できません。画像を削除するか、画像対応モデルを選んでください。",
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
    setSubmitting(true);
    setError(null);
    try {
      const [providerID, modelID] = model ? model.split("::") : [];
      const data = await sendJson<{ taskId: string }>("POST", "/api/tasks", {
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
        ...(agent ? { agent, subagentPermission } : {}),
        ...(intelligence ? { variant: intelligence } : {}),
      });
      // Remember the model actually applied to this submission so the next
      // new session preselects it.
      writeLastUsedModel(sendingModelKey || null);
      notifyTasksChanged();
      router.push(`/task/${data.taskId}`);
    } catch (err) {
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
    agent,
    agentModels,
    intelligence,
    subagentPermission,
    submitting,
    engineOk,
    router,
  ]);

  // No live session exists on Home, and a session-scoped ruleset is the only
  // enforcement OpenCode actually honours at runtime. So store the preference
  // here and let POST /api/tasks apply it to the new session at creation time.
  const changeSubagentPermission = useCallback((mode: SubagentPermission) => {
    setSubagentPermission(mode);
    writeSubagentPermission(mode);
  }, []);

  const addImageFiles = useCallback(async (files: FileList | File[]) => {
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
        const uri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error ?? new Error("read failed"));
          reader.readAsDataURL(file);
        });
        if (estimateDataUrlBytes(uri) > MAX_IMAGE_SIZE_BYTES) {
          rejected += 1;
          continue;
        }
        candidates.push({ uri, mime: file.type, name: file.name, preview: uri });
      } catch {
        rejected += 1;
      }
    }

    let appended = 0;
    setAttachments((current) => {
      const room = Math.max(0, MAX_IMAGE_COUNT - current.length);
      const take = candidates.slice(0, room);
      appended = take.length;
      return take.length > 0 ? [...current, ...take] : current;
    });

    const skipped = rejected + (candidates.length - appended);
    if (skipped > 0) {
      setError(
        `一部の画像をスキップしました（上限 ${MAX_IMAGE_COUNT} 枚 / ${Math.floor(MAX_IMAGE_SIZE_BYTES / (1024 * 1024))} MB）。`,
      );
    }
  }, []);

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

  const removeAttachment = useCallback((index: number) => {
    setAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }, []);

  // Calculate intelligence variants based on the effective model (agent's model
  // if agent is selected, otherwise manual model). This ensures the variants
  // match the actual model being used, not the manual selection (R24).
  const effectiveModelKey = useMemo(() => {
    if (agent) {
      const agentModel = agentModels[agent];
      if (agentModel) return `${agentModel.providerID}::${agentModel.modelID}`;
    }
    return model;
  }, [agent, agentModels, model]);

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

  return (
    <div className="flex h-full flex-col">
      <MobileMenuHeader />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-clip">
      <main
        className={cx(
          "mx-auto flex min-h-full max-w-4xl flex-col justify-center px-4 py-12 pb-[max(6rem,env(safe-area-inset-bottom))]",
          slashOpen && "pt-64",
        )}
      >
        <section>
          <h1 className="mb-6 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
            何をつくりますか？
          </h1>
          <form
            aria-label="タスク作成"
            className="relative mx-auto max-w-4xl rounded-2xl border border-border bg-surface shadow-sm focus-within:border-border-strong focus-within:ring-2 focus-within:ring-primary/20"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {slashOpen && (
              <SlashSuggestMenu
                items={slashItems}
                activeIndex={slashIndex}
                onHover={setSlashIndex}
                onSelect={(cmd) => applySlash(cmd.name)}
              />
            )}
            <textarea
              ref={textareaRef}
              value={prompt}
              rows={2}
              style={{ fontSize: "16px", textSizeAdjust: "100%", WebkitTextSizeAdjust: "100%" }}
              aria-label="タスクの説明"
              role="combobox"
              aria-busy={submitting || undefined}
              aria-autocomplete="list"
              aria-controls={slashOpen ? "slash-suggest-listbox" : undefined}
              aria-expanded={slashOpen}
              aria-activedescendant={
                slashOpen && slashItems[slashIndex]
                  ? `slash-cmd-${slashItems[slashIndex].name}`
                  : undefined
              }
              readOnly={submitting}
              onChange={(e) => {
                setPrompt(e.target.value);
                setCursor(e.target.selectionStart ?? e.target.value.length);
                autoResize();
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
                      (i) => (i - 1 + slashItems.length) % slashItems.length,
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
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pb-2">
                {attachments.map((attachment, index) => (
                  <div
                    key={`${attachment.name ?? attachment.uri}-${index}`}
                    className="group relative h-14 w-14 overflow-hidden rounded-lg border border-border bg-surface"
                  >
                    {attachment.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={attachment.preview}
                        alt={attachment.name ?? "添付画像"}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-faint">
                        <Paperclip className="h-4 w-4" aria-hidden="true" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(index)}
                      disabled={submitting}
                      aria-label={`${attachment.name ?? "添付画像"}を削除`}
                      className="absolute right-0.5 top-0.5 rounded-full bg-bg/80 p-0.5 text-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 max-sm:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-1.5 px-3 pb-3">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={submitting}
                    aria-label="画像ファイルを選択"
                    className="hidden"
                    onChange={(event) => {
                      if (event.target.files) void addImageFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={submitting}
                    aria-label="画像を添付"
                    title="画像を添付"
                    className="flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-muted transition-colors hover:bg-accent hover:text-fg disabled:opacity-40"
                  >
                    <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <VoiceInputButton
                    voice={voice}
                    onTranscript={onVoiceTranscript}
                    onNativeVoiceStart={() => textareaRef.current?.focus()}
                    disabled={submitting}
                  />
                  <GhostSelect
                    value={projectId}
                    disabled={projects.length === 0 || submitting}
                    aria-label="プロジェクト"
                    icon={<FolderGit2 className="h-3.5 w-3.5" />}
                    valueLabel={
                      selectedProject
                        ? `${selectedProject.favorite ? "★ " : ""}${selectedProject.name}`
                        : "プロジェクトなし"
                    }
                    onChange={(e) => setProjectId(e.target.value)}
                    className="min-w-0"
                    title={
                      selectedProject
                        ? `${selectedProject.favorite ? "★ " : ""}${selectedProject.name}`
                        : "プロジェクトなし"
                    }
                  >
                    {projects.length === 0 && (
                      <option value="">プロジェクトなし</option>
                    )}
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
                      isolation === "current_folder"
                        ? defaultBranchLabel
                        : "worktree"
                    }
                    onChange={(e) =>
                      setIsolation(
                        e.target.value as "current_folder" | "git_worktree",
                      )
                    }
                    className="min-w-0"
                    title="master: 現在ブランチで作業 / worktree: 分離ブランチ"
                  >
                    <option value="current_folder">{defaultBranchLabel}</option>
                    <option value="git_worktree">worktree</option>
                  </GhostSelect>
                </div>
                <Button
                  variant="primary"
                  size="icon"
                  type="submit"
                  aria-label="タスク開始"
                  className="shrink-0"
                  busy={submitting}
                  disabled={
                    (!prompt.trim() && attachments.length === 0) ||
                    !projectId ||
                    submitting ||
                    !engineOk ||
                    (isolation === "git_worktree" &&
                      branchProjectId !== projectId)
                  }
                >
                  {!submitting && <ArrowUp className="h-4.5 w-4.5" />}
                </Button>
              </div>
              <div className="flex min-w-0 items-center gap-1.5">
                {modelOptions.length > 0 && (
                  <ModelSelect
                    value={model}
                    disabled={submitting}
                    options={modelOptions}
                    onChange={(value) => {
                      setModel(value);
                      setIntelligence("");
                    }}
                    className="min-w-0"
                    title={selectedModel?.label ?? "モデル"}
                  />
                )}
                {intelligenceVariants.length > 0 && (
                  <IntelligenceSelect
                    variants={intelligenceVariants}
                    value={intelligence}
                    onChange={(v) =>
                      setIntelligence(isIntelligenceVariant(v) ? v : "")
                    }
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
                    onChange={(e) => {
                      setAgent(e.target.value);
                      setIntelligence("");
                    }}
                    className="min-w-0"
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
                  className="min-w-0 shrink"
                />
                <SubagentPermissionSelect
                  value={subagentPermission}
                  disabled={submitting}
                  onChange={(m) => changeSubagentPermission(m)}
                  className="min-w-0 shrink"
                />
              </div>
            </div>
          </form>

          {loaded && !engineOk && (
            <p className="mx-auto mt-3 max-w-2xl rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
              エンジン未接続。設定またはトレイから OpenCode を再起動してください。
            </p>
          )}

          {loaded && projects.length === 0 && (
            <div className="mx-auto mt-4 max-w-2xl">
              <p className="mb-3 text-center text-sm text-muted">
                まずプロジェクトフォルダを追加してください
              </p>
              <AddProjectButton
                onAdded={(project) => {
                  void refreshProjects().then(() => setProjectId(project.id));
                }}
              />
            </div>
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
