"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Bot, Cpu, FolderGit2, GitBranch } from "lucide-react";
import { AccessModeSelect } from "@/components/AccessModeSelect";
import { AddProjectButton } from "@/components/AddProjectButton";
import { IntelligenceSelect } from "@/components/IntelligenceSelect";
import { Button, GhostSelect } from "@/components/ui";
import {
  readAccessMode,
  writeAccessMode,
  type AccessMode,
} from "@/lib/access-mode";
import { notifyTasksChanged } from "@/lib/events";
import { getJson, sendJson } from "@/lib/client";
import {
  getIntelligenceVariants,
  type IntelligenceVariant,
  type ProviderModelMeta,
} from "@/lib/model-variants";
import type { ProjectDto } from "@/lib/types";

type ModelOption = { value: string; label: string; group: string };

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

function formatAgentLabel(agent: string): string {
  if (agent === "build") return "build（Code）";
  if (agent === "plan") return "plan（Plan）";
  return /ask|explore/i.test(agent) ? `${agent}（Ask）` : agent;
}

export function HomeView() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [engineOk, setEngineOk] = useState(true);
  const [projectId, setProjectId] = useState("");
  const [isolation, setIsolation] = useState<"current_folder" | "git_worktree">(
    "current_folder",
  );
  const [prompt, setPrompt] = useState("");
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
  const composingRef = useRef(false);

  useEffect(() => {
    setAccessMode(readAccessMode());
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const data = await getJson<{ projects: ProjectDto[] }>("/api/projects");
      setProjects(data.projects ?? []);
      setProjectId((cur) => cur || data.projects?.[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "projects failed");
    }
  }, []);

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
                label: m.name || mid,
                group: p.name || p.id,
              });
              map[`${p.id}::${mid}`] = {
                name: m.name,
                variants: m.variants,
              };
            }
          }
          setModelOptions(options);
          setProviderModelsMap(map);

          // Prefer OpenCode config.model (provider/modelID), then provider defaults
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

  const submit = useCallback(async () => {
    const text = prompt.trim();
    const branchReady =
      isolation !== "git_worktree" || branchProjectId === projectId;
    if (!text || !projectId || submitting || !engineOk || !branchReady) return;
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
        ...(requestBaseBranch ? { baseBranch: requestBaseBranch } : {}),
        ...(providerID && modelID ? { model: { providerID, modelID } } : {}),
        ...(agent ? { agent } : {}),
        ...(intelligence ? { variant: intelligence } : {}),
      });
      notifyTasksChanged();
      router.push(`/task/${data.taskId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "タスク作成に失敗しました");
      setSubmitting(false);
    }
  }, [
    prompt,
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
            何をつくりますか？
          </h1>
          <form
            aria-label="タスク作成"
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
              readOnly={submitting}
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
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 px-3 pb-3 xl:grid-cols-[auto_minmax(0,1fr)_auto] xl:gap-2">
              <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 xl:col-start-1 xl:row-start-1">
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
                  className="min-w-0 flex-1 xl:min-w-40 xl:max-w-44"
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
                  className="min-w-0 flex-1 xl:min-w-32 xl:max-w-32"
                  title="master: 現在ブランチで作業 / worktree: 分離ブランチ"
                >
                  <option value="current_folder">{defaultBranchLabel}</option>
                  <option value="git_worktree">worktree</option>
                </GhostSelect>
              </div>
              <div className="col-span-2 row-start-2 grid min-w-0 grid-cols-2 items-center gap-2 overflow-visible min-[480px]:grid-cols-3 xl:col-span-1 xl:col-start-2 xl:row-start-1 xl:grid-cols-[8rem_7rem_8rem_9rem]">
                {modelOptions.length > 0 && (
                  <GhostSelect
                    value={model}
                    disabled={submitting}
                    aria-label="モデル"
                    icon={<Cpu className="h-3.5 w-3.5" />}
                    valueLabel={selectedModel?.label ?? "モデル"}
                    onChange={(e) => {
                      setModel(e.target.value);
                      setIntelligence("");
                    }}
                    className="w-full min-w-0"
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
                      setIntelligence(
                        v === "high" || v === "low" ? v : "",
                      )
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
                    valueLabel={formatAgentLabel(agent)}
                    onChange={(e) => setAgent(e.target.value)}
                    className="w-full min-w-0 min-[480px]:min-w-[9rem]"
                    title="エージェント（OpenCode agent）"
                  >
                    {agents.map((a) => (
                      <option key={a} value={a}>
                        {formatAgentLabel(a)}
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
                  className="order-first w-full min-w-0 xl:order-none"
                />
              </div>
              <Button
                variant="primary"
                size="icon"
                type="submit"
                aria-label="タスク開始"
                className="col-start-2 row-start-1 shrink-0 xl:col-start-3 xl:row-start-1"
                busy={submitting}
                disabled={
                  !prompt.trim() ||
                  !projectId ||
                  !engineOk ||
                  (isolation === "git_worktree" &&
                    branchProjectId !== projectId)
                }
              >
                {!submitting && <ArrowUp className="h-4.5 w-4.5" />}
              </Button>
            </div>
          </form>

          {loaded && !engineOk && (
            <p className="mx-auto mt-3 max-w-2xl rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
              エンジン未接続。トレイから再起動してください。
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
  );
}
