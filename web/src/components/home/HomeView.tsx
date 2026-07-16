"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Plus } from "lucide-react";
import { ISOLATIONS } from "@/components/StatusBadge";
import { Button } from "@/components/ui";
import { notifyTasksChanged } from "@/components/shell/Sidebar";
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
  const [newProjectPath, setNewProjectPath] = useState("");
  const [addingProject, setAddingProject] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [agent, setAgent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);

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
    fetch("/api/opencode/provider", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ProviderResponse>) : null))
      .then((data) => {
        if (!data) return;
        const connected = new Set(data.connected ?? []);
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
      })
      .catch(() => undefined);
    fetch("/api/opencode/agent", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AgentResponse>) : null))
      .then((data) => {
        if (!data) return;
        setAgents(
          data
            .filter((a) => a.mode !== "subagent" && !a.hidden)
            .map((a) => a.name),
        );
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void Promise.all([refreshProjects(), refreshEngine()]).finally(() =>
      setLoaded(true),
    );
  }, [refreshProjects, refreshEngine]);

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
        ...(providerID && modelID ? { model: { providerID, modelID } } : {}),
        ...(agent ? { agent } : {}),
      });
      notifyTasksChanged();
      router.push(`/task/${data.taskId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "タスク作成に失敗しました");
      setSubmitting(false);
    }
  }, [prompt, projectId, isolation, model, agent, submitting, router]);

  const addProject = useCallback(async () => {
    const p = newProjectPath.trim();
    if (!p) return;
    setAddingProject(true);
    setError(null);
    try {
      const data = await sendJson<{ project: ProjectDto }>("POST", "/api/projects", {
        rootPath: p,
      });
      setNewProjectPath("");
      await refreshProjects();
      setProjectId(data.project.id);
      notifyTasksChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "プロジェクト追加に失敗しました");
    } finally {
      setAddingProject(false);
    }
  }, [newProjectPath, refreshProjects]);

  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto flex min-h-full max-w-4xl flex-col justify-center px-4 py-12 pb-24">
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
            <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="h-9 max-w-44 cursor-pointer rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium text-muted outline-none hover:text-text"
              >
                {projects.length === 0 && <option value="">プロジェクトなし</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.favorite ? "★ " : ""}
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={isolation}
                onChange={(e) => setIsolation(e.target.value)}
                className="h-9 cursor-pointer rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium text-muted outline-none hover:text-text"
              >
                {ISOLATIONS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
              {modelOptions.length > 0 && (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="h-9 max-w-40 cursor-pointer rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium text-muted outline-none hover:text-text"
                >
                  <option value="">モデル: 既定</option>
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
                  className="h-9 max-w-36 cursor-pointer rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium text-muted outline-none hover:text-text"
                >
                  <option value="">エージェント: 既定</option>
                  {agents.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex-1" />
              <Button
                variant="primary"
                size="icon"
                aria-label="タスク開始"
                busy={submitting}
                disabled={!prompt.trim() || !projectId || !engineOk}
                onClick={() => void submit()}
              >
                {!submitting && <ArrowUp className="h-4.5 w-4.5" />}
              </Button>
            </div>
          </div>

          {loaded && projects.length === 0 && (
            <div className="mx-auto mt-4 flex max-w-2xl gap-2">
              <input
                value={newProjectPath}
                onChange={(e) => setNewProjectPath(e.target.value)}
                placeholder="C:\path\to\repo — まずプロジェクトを追加"
                className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-border-strong"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addProject();
                }}
              />
              <Button busy={addingProject} onClick={() => void addProject()}>
                <Plus className="h-4 w-4" />
                追加
              </Button>
            </div>
          )}

          {error && (
            <p className="mx-auto mt-3 max-w-2xl rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
