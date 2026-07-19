"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Bot, Cpu, FolderGit2, GitBranch, Paperclip, X } from "lucide-react";
import { AccessModeSelect } from "@/components/AccessModeSelect";
import { AddProjectButton } from "@/components/AddProjectButton";
import { IntelligenceSelect } from "@/components/IntelligenceSelect";
import { Button, GhostSelect } from "@/components/ui";
import {
  readAccessMode,
  writeAccessMode,
  type AccessMode,
} from "@/lib/access-mode";
import { readDefaultModel } from "@/lib/default-model";
import { providerIconSrcForOpencodeId } from "@/lib/addons/codexbar";
import { notifyTasksChanged } from "@/lib/events";
import { getJson, sendJson } from "@/lib/client";
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
import type { ProjectDto } from "@/lib/types";

type ProviderResponse = {
  all: {
    id: string;
    name: string;
    models: Record<string, { name?: string; variants?: ProviderModelMeta["variants"] }>;
  }[];
  connected: string[];
  default: Record<string, string>;
};

type AgentResponse = { name: string; mode?: string; hidden?: boolean }[];

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
  const [agents, setAgents] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [agent, setAgent] = useState("");
  const [intelligence, setIntelligence] = useState<IntelligenceVariant | "">("");
  const [providerModelsMap, setProviderModelsMap] = useState<
    Record<string, ProviderModelMeta>
  >({});
  const [accessMode, setAccessMode] = useState<AccessMode>("ask");
  const [baseBranch, setBaseBranch] = useState("");
  const [branchProjectId, setBranchProjectId] = useState("");
  const [defaultBranchLabel, setDefaultBranchLabel] = useState("master");
  const [loaded, setLoaded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);

  useEffect(() => {
    setAccessMode(readAccessMode());
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
          const map: Record<string, ProviderModelMeta> = {};
          for (const p of data.all ?? []) {
            if (connected.size > 0 && !connected.has(p.id)) continue;
            for (const [mid, m] of Object.entries(p.models ?? {})) {
              options.push({
                value: `${p.id}::${mid}`,
                label: formatModelLabel(m.name, mid),
                group: p.name || p.id,
              });
              map[`${p.id}::${mid}`] = {
                name: m.name,
                variants: m.variants,
              };
            }
          }
          setModelOptions(sortModelOptions(options));
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
    setDefaultBranchLabel("隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ窶ｦ");
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
        setDefaultBranchLabel("迴ｾ蝨ｨ縺ｮ HEAD");
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
        ...(agent ? { agent } : {}),
        ...(intelligence ? { variant: intelligence } : {}),
      });
      notifyTasksChanged();
      router.push(`/task/${data.taskId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "繧ｿ繧ｹ繧ｯ菴懈・縺ｫ螟ｱ謨励＠縺ｾ縺励◆");
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
    agent,
    intelligence,
    submitting,
    engineOk,
    router,
  ]);

  const addImageFiles = useCallback(async (files: FileList | File[]) => {
    const next: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (!IMAGE_MIME_RE.test(file.type)) continue;
      try {
        const uri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error ?? new Error("read failed"));
          reader.readAsDataURL(file);
        });
        next.push({ uri, mime: file.type, name: file.name, preview: uri });
      } catch {
        /* skip unreadable file */
      }
    }
    if (next.length > 0) setAttachments((current) => [...current, ...next]);
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

  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedModel = modelOptions.find((option) => option.value === model);

  const intelligenceVariants = useMemo(() => {
    if (!model) return [];
    const modelMeta = providerModelsMap[model];
    if (!modelMeta) return [];
    return getIntelligenceVariants(modelMeta);
  }, [model, providerModelsMap]);

  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto flex min-h-full max-w-4xl flex-col justify-center px-4 py-12 pb-[max(6rem,env(safe-area-inset-bottom))]">
        <section>
          <h1 className="mb-6 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
            菴輔ｒ縺､縺上ｊ縺ｾ縺吶°・・
          </h1>
          <form
            aria-label="繧ｿ繧ｹ繧ｯ菴懈・"
            className="mx-auto max-w-4xl rounded-2xl border border-border bg-surface shadow-sm focus-within:border-border-strong focus-within:ring-2 focus-within:ring-primary/20"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <textarea
              ref={textareaRef}
              value={prompt}
              rows={2}
              aria-label="繧ｿ繧ｹ繧ｯ縺ｮ隱ｬ譏・
              readOnly={submitting}
              onChange={(e) => {
                setPrompt(e.target.value);
                autoResize();
              }}
              onPaste={onPaste}
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
              placeholder="繧ｿ繧ｹ繧ｯ繧定ｪｬ譏弱＠縺ｦ縺上□縺輔＞窶ｦ・・trl+Enter 縺ｧ髢句ｧ具ｼ・
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
                        alt={attachment.name ?? "豺ｻ莉倡判蜒・}
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
                      aria-label={`${attachment.name ?? "豺ｻ莉倡判蜒・}繧貞炎髯､`}
                      className="absolute right-0.5 top-0.5 rounded-full bg-bg/80 p-0.5 text-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
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
                    aria-label="逕ｻ蜒上ヵ繧｡繧､繝ｫ繧帝∈謚・
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
                    aria-label="逕ｻ蜒上ｒ豺ｻ莉・
                    title="逕ｻ蜒上ｒ豺ｻ莉・
                    className="flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-muted transition-colors hover:bg-accent hover:text-fg disabled:opacity-40"
                  >
                    <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <GhostSelect
                    value={projectId}
                    disabled={projects.length === 0 || submitting}
                    aria-label="繝励Ο繧ｸ繧ｧ繧ｯ繝・
                    icon={<FolderGit2 className="h-3.5 w-3.5" />}
                    valueLabel={
                      selectedProject
                        ? `${selectedProject.favorite ? "笘・" : ""}${selectedProject.name}`
                        : "繝励Ο繧ｸ繧ｧ繧ｯ繝医↑縺・
                    }
                    onChange={(e) => setProjectId(e.target.value)}
                    className="min-w-0"
                    title={
                      selectedProject
                        ? `${selectedProject.favorite ? "笘・" : ""}${selectedProject.name}`
                        : "繝励Ο繧ｸ繧ｧ繧ｯ繝医↑縺・
                    }
                  >
                    {projects.length === 0 && (
                      <option value="">繝励Ο繧ｸ繧ｧ繧ｯ繝医↑縺・/option>
                    )}
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.favorite ? "笘・" : ""}
                        {p.name}
                      </option>
                    ))}
                  </GhostSelect>
                  <GhostSelect
                    value={isolation}
                    disabled={submitting}
                    aria-label="菴懈･ｭ蝣ｴ謇"
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
                    title="master: 迴ｾ蝨ｨ繝悶Λ繝ｳ繝√〒菴懈･ｭ / worktree: 蛻・屬繝悶Λ繝ｳ繝・
                  >
                    <option value="current_folder">{defaultBranchLabel}</option>
                    <option value="git_worktree">worktree</option>
                  </GhostSelect>
                </div>
                <Button
                  variant="primary"
                  size="icon"
                  type="submit"
                  aria-label="繧ｿ繧ｹ繧ｯ髢句ｧ・
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
                  <GhostSelect
                    value={model}
                    disabled={submitting}
                    aria-label="繝｢繝・Ν"
                    icon={<ModelSelectIcon model={model} />}
                    valueLabel={selectedModel?.label ?? "繝｢繝・Ν"}
                    onChange={(e) => {
                      setModel(e.target.value);
                      setIntelligence("");
                    }}
                    className="min-w-0"
                    title={selectedModel?.label ?? "繝｢繝・Ν"}
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
                    disabled={submitting}
                  />
                )}
                {agents.length > 0 && (
                  <GhostSelect
                    value={agent}
                    disabled={submitting}
                    aria-label="繧ｨ繝ｼ繧ｸ繧ｧ繝ｳ繝・
                    icon={<Bot className="h-3.5 w-3.5" />}
                    valueLabel={agent || "繧ｨ繝ｼ繧ｸ繧ｧ繝ｳ繝・}
                    onChange={(e) => setAgent(e.target.value)}
                    className="min-w-0"
                    title={agent || "繧ｨ繝ｼ繧ｸ繧ｧ繝ｳ繝・}
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
              </div>
            </div>
          </form>

          {loaded && !engineOk && (
            <p className="mx-auto mt-3 max-w-2xl rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
              繧ｨ繝ｳ繧ｸ繝ｳ譛ｪ謗･邯壹りｨｭ螳壹∪縺溘・繝医Ξ繧､縺九ｉ OpenCode 繧貞・襍ｷ蜍輔＠縺ｦ縺上□縺輔＞縲・
            </p>
          )}

          {loaded && projects.length === 0 && (
            <div className="mx-auto mt-4 max-w-2xl">
              <p className="mb-3 text-center text-sm text-muted">
                縺ｾ縺壹・繝ｭ繧ｸ繧ｧ繧ｯ繝医ヵ繧ｩ繝ｫ繝繧定ｿｽ蜉縺励※縺上□縺輔＞
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
  );
}
