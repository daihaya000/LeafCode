"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp } from "lucide-react";
import { AccessModeSelect } from "@/components/AccessModeSelect";
import { AddProjectButton } from "@/components/AddProjectButton";
import { ISOLATIONS } from "@/components/StatusBadge";
import { Button } from "@/components/ui";
import {
  readAccessMode,
  writeAccessMode,
  type AccessMode,
} from "@/lib/access-mode";
import { notifyTasksChanged } from "@/lib/events";
import { getJson, sendJson } from "@/lib/client";
import type { ProjectDto } from "@/lib/types";

type ModelOption = { value: string; label: string; group: string };

type ProviderResponse = {
  all: { id: string; name: string; models: Record<string, { name?: string }> }[];
  connected: string[];
  default: Record<string, string>;
};

type AgentResponse = { name: string; mode?: string; hidden?: boolean }[];

export function HomeView() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [engineOk, setEngineOk] = useState(true);
  const [projectId, setProjectId] = useState("");
  const [isolation, setIsolation] = useState<string>("git_worktree");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [agent, setAgent] = useState("");
  const [accessMode, setAccessMode] = useState<AccessMode>("ask");
  const [baseBranch, setBaseBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
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
    if (!project?.rootPath || isolation === "current_folder") {
      setBranches([]);
      setBaseBranch("");
      return;
    }
    void (async () => {
      try {
        const info = await getJson<{
          branches: string[];
          defaultTarget: string | null;
          current: string;
        }>("/api/git/branches", { directory: project.rootPath });
        setBranches(info.branches ?? []);
        setBaseBranch((cur) => cur || info.defaultTarget || info.current || "");
      } catch {
        setBranches([]);
      }
    })();
  }, [projectId, projects, isolation]);

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
      const [providerID, modelID] = model ? model.split("::") : [];
      const data = await sendJson<{ taskId: string }>("POST", "/api/tasks", {
        projectId,
        prompt: text,
        isolation,
        ...(baseBranch ? { baseBranch } : {}),
        ...(providerID && modelID ? { model: { providerID, modelID } } : {}),
        ...(agent ? { agent } : {}),
      });
      notifyTasksChanged();
      router.push(`/task/${data.taskId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "タスク作成に失敗しました");
      setSubmitting(false);
    }
  }, [prompt, projectId, isolation, baseBranch, model, agent, submitting, router]);

  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto flex min-h-full max-w-4xl flex-col justify-center px-4 py-12 pb-[max(6rem,env(safe-area-inset-bottom))]">
        <section>
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
            <div className="flex items-center gap-2 px-3 pb-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="h-9 max-w-[9rem] shrink-0 cursor-pointer rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium text-muted outline-none hover:text-text sm:max-w-44"
              >
                {projects.length === 0 && <option value="">プロジェクトなし</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.favorite ? "★ " : ""}
                    {p.name}
                  </option>
                ))}
              </select>
              <AccessModeSelect
                value={accessMode}
                onChange={(m) => {
                  setAccessMode(m);
                  writeAccessMode(m);
                }}
                className="h-9 shrink-0"
              />
              <select
                value={isolation}
                onChange={(e) => setIsolation(e.target.value)}
                className="h-9 max-w-[9rem] shrink-0 cursor-pointer rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium text-muted outline-none hover:text-text"
              >
                {ISOLATIONS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
              {branches.length > 0 && isolation !== "current_folder" && (
                <select
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  className="h-9 max-w-[7rem] shrink-0 cursor-pointer rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium text-muted outline-none hover:text-text sm:max-w-36"
                  title="ベースブランチ"
                >
                  {branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              )}
              {modelOptions.length > 0 && (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="h-9 max-w-[9rem] shrink-0 cursor-pointer rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium text-muted outline-none hover:text-text sm:max-w-40"
                >
                  {[...new Set(modelOptions.map((o) => o.group))].map((group) => (
                    <optgroup key={group} label={group}>
                      {modelOptions
                        .filter((o) => o.group === group)
                        .map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              )}
              {agents.length > 0 && (
                <select
                  value={agent}
                  onChange={(e) => setAgent(e.target.value)}
                  className="h-9 max-w-[8rem] shrink-0 cursor-pointer rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium text-muted outline-none hover:text-text sm:max-w-36"
                  title="エージェント（OpenCode agent）"
                >
                  {agents.map((a) => (
                    <option key={a} value={a}>
                      {a === "build"
                        ? "build（Code）"
                        : a === "plan"
                          ? "plan（Plan）"
                          : /ask|explore/i.test(a)
                            ? `${a}（Ask）`
                            : a}
                    </option>
                  ))}
                </select>
              )}
              </div>
              <Button
                variant="primary"
                size="icon"
                aria-label="タスク開始"
                className="shrink-0"
                busy={submitting}
                disabled={!prompt.trim() || !projectId || !engineOk}
                onClick={() => void submit()}
              >
                {!submitting && <ArrowUp className="h-4.5 w-4.5" />}
              </Button>
            </div>
          </div>

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
            <p className="mx-auto mt-3 max-w-2xl break-all rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
