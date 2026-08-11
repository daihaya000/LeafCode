"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileText, Plus, Sparkles, Trash2, Users } from "lucide-react";
import { MobileMenuHeader } from "@/components/shell/MobileMenuHeader";
import { useMobileScrollTarget } from "@/components/shell/MobileScrollTargetContext";
import { Badge, Button, cx, Spinner } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client";
import type {
  ProjectSettingFileDto,
  ProjectSettingFileKey,
} from "@/lib/project-settings";
import type { ProjectAgentDto } from "@/lib/project-agents";
import type { ProjectSkillDto } from "@/lib/project-skills";
import { parseFrontmatterFields } from "@/lib/skill-frontmatter";

type ProjectSettingsResponse = {
  project: { id: string; name: string; rootPath: string };
  files: ProjectSettingFileDto[];
};

type ProjectAgentsResponse = {
  project: { id: string; name: string; rootPath: string };
  agents: ProjectAgentDto[];
};

type ProjectSkillsResponse = {
  project: { id: string; name: string; rootPath: string };
  skills: ProjectSkillDto[];
};

type Tab = "files" | "agents" | "skills";

const DEFAULT_AGENT_TEMPLATE = `---
description: ""
mode: subagent
model: openai/gpt-5
---
`;

function defaultSkillTemplate(name: string): string {
  return `---\nname: ${name}\ndescription: ""\n---\n\n# ${name}\n`;
}

export function ProjectSettingsView({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<Tab>("files");
  const [data, setData] = useState<ProjectSettingsResponse | null>(null);
  const [agents, setAgents] = useState<ProjectAgentDto[]>([]);
  const [skills, setSkills] = useState<ProjectSkillDto[]>([]);
  const [activeFile, setActiveFile] = useState<ProjectSettingFileKey>("AGENTS.md");
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [activeSkill, setActiveSkill] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newAgentName, setNewAgentName] = useState("");
  const [newSkillName, setNewSkillName] = useState("");
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [creatingSkill, setCreatingSkill] = useState(false);
  const setScrollTarget = useMobileScrollTarget();

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getJson<ProjectSettingsResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/settings`,
      );
      setData(result);
      const selected = result.files.find((file) => file.key === "AGENTS.md") ?? result.files[0];
      if (selected) {
        setActiveFile(selected.key);
        setDraft(selected.content);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "プロジェクト設定の読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadAgents = useCallback(async () => {
    setError(null);
    try {
      const result = await getJson<ProjectAgentsResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/agents`,
      );
      setAgents(result.agents);
      if (result.agents.length > 0) {
        setActiveAgent(result.agents[0].name);
        setDraft(result.agents[0].content);
      } else {
        setActiveAgent(null);
        setDraft("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "サブエージェント一覧の取得に失敗しました");
    }
  }, [projectId]);

  const loadSkills = useCallback(async () => {
    setError(null);
    try {
      const result = await getJson<ProjectSkillsResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/skills`,
      );
      setSkills(result.skills);
      if (result.skills.length > 0) {
        setActiveSkill(result.skills[0].name);
        setDraft(result.skills[0].content);
      } else {
        setActiveSkill(null);
        setDraft("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "スキル一覧の取得に失敗しました");
    }
  }, [projectId]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (tab === "agents") void loadAgents();
    if (tab === "skills") void loadSkills();
  }, [tab, loadAgents, loadSkills]);

  const selectFile = (key: ProjectSettingFileKey) => {
    const file = data?.files.find((candidate) => candidate.key === key);
    if (!file) return;
    setActiveFile(key);
    setDraft(file.content);
    setMessage(null);
    setError(null);
  };

  const selectAgent = (name: string) => {
    const agent = agents.find((candidate) => candidate.name === name);
    if (!agent) return;
    setActiveAgent(name);
    setDraft(agent.content);
    setMessage(null);
    setError(null);
  };

  const selectSkill = (name: string) => {
    const skill = skills.find((candidate) => candidate.name === name);
    if (!skill) return;
    setActiveSkill(name);
    setDraft(skill.content);
    setMessage(null);
    setError(null);
  };

  const saveFile = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await sendJson(
        "PATCH",
        `/api/projects/${encodeURIComponent(projectId)}/settings`,
        { file: activeFile, content: draft },
      );
      setData((current) =>
        current
          ? {
              ...current,
              files: current.files.map((file) =>
                file.key === activeFile ? { ...file, exists: true, content: draft } : file,
              ),
            }
          : current,
      );
      setMessage(`${activeFile}を保存しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "プロジェクト設定の保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const saveAgent = async () => {
    if (saving || !activeAgent) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await sendJson<{ agent: ProjectAgentDto }>(
        "PUT",
        `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(activeAgent)}`,
        { content: draft },
      );
      setAgents((current) =>
        current.map((a) => (a.name === activeAgent ? res.agent : a)),
      );
      setMessage(`サブエージェント「${activeAgent}」を保存しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "サブエージェントの保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const createAgent = async () => {
    if (creatingAgent) return;
    const name = newAgentName.trim();
    if (!name) return;
    setCreatingAgent(true);
    setError(null);
    setMessage(null);
    try {
      const res = await sendJson<{ agent: ProjectAgentDto }>(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/agents`,
        { name, content: DEFAULT_AGENT_TEMPLATE },
      );
      setAgents((current) =>
        [...current, res.agent].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setActiveAgent(name);
      setDraft(DEFAULT_AGENT_TEMPLATE);
      setNewAgentName("");
      setMessage(`サブエージェント「${name}」を作成しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "サブエージェントの作成に失敗しました");
    } finally {
      setCreatingAgent(false);
    }
  };

  const removeAgent = async (name: string) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await sendJson(
        "DELETE",
        `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(name)}`,
      );
      const remaining = agents.filter((a) => a.name !== name);
      setAgents(remaining);
      if (activeAgent === name) {
        if (remaining.length > 0) {
          setActiveAgent(remaining[0].name);
          setDraft(remaining[0].content);
        } else {
          setActiveAgent(null);
          setDraft("");
        }
      }
      setMessage(`サブエージェント「${name}」を削除しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "サブエージェントの削除に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const saveSkill = async () => {
    if (saving || !activeSkill) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await sendJson<{ skill: ProjectSkillDto }>(
        "PUT",
        `/api/projects/${encodeURIComponent(projectId)}/skills/${encodeURIComponent(activeSkill)}`,
        { content: draft },
      );
      setSkills((current) =>
        current.map((skill) => (skill.name === activeSkill ? res.skill : skill)),
      );
      setMessage(`スキル「${activeSkill}」を保存しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "スキルの保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const createSkill = async () => {
    if (creatingSkill) return;
    const name = newSkillName.trim();
    if (!name) return;
    const content = defaultSkillTemplate(name);
    setCreatingSkill(true);
    setError(null);
    setMessage(null);
    try {
      const res = await sendJson<{ skill: ProjectSkillDto }>(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/skills`,
        { name, content },
      );
      setSkills((current) =>
        [...current, res.skill].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setActiveSkill(name);
      setDraft(content);
      setNewSkillName("");
      setMessage(`スキル「${name}」を作成しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "スキルの作成に失敗しました");
    } finally {
      setCreatingSkill(false);
    }
  };

  const removeSkill = async (name: string) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await sendJson(
        "DELETE",
        `/api/projects/${encodeURIComponent(projectId)}/skills/${encodeURIComponent(name)}`,
      );
      const remaining = skills.filter((skill) => skill.name !== name);
      setSkills(remaining);
      if (activeSkill === name) {
        setActiveSkill(remaining[0]?.name ?? null);
        setDraft(remaining[0]?.content ?? "");
      }
      setMessage(`スキル「${name}」を削除しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "スキルの削除に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const selected = data?.files.find((file) => file.key === activeFile);
  const selectedAgent = agents.find((a) => a.name === activeAgent);
  const selectedSkill = skills.find((skill) => skill.name === activeSkill);

  return (
    <div className="flex h-full flex-col">
      <MobileMenuHeader />
      <div ref={setScrollTarget} className="min-h-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
          <div className="mx-auto flex min-h-14 max-w-6xl items-center gap-3 px-4 py-2">
            <Link
              href="/settings"
              aria-label="全体設定へ戻る"
              className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">
                {data?.project.name ?? "プロジェクト設定"}
              </h1>
              {data && (
                <p className="truncate font-mono text-[11px] text-faint">
                  {data.project.rootPath}
                </p>
              )}
            </div>
          </div>
          <div className="mx-auto max-w-6xl px-4 pb-2">
            <div role="tablist" aria-label="プロジェクト設定カテゴリ" className="flex gap-x-2">
              {([
                { key: "files", label: "設定ファイル" },
                { key: "agents", label: "サブエージェント" },
                { key: "skills", label: "スキル" },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={cx(
                    "cursor-pointer border-b-2 px-3 py-1.5 text-sm font-medium whitespace-nowrap",
                    tab === t.key
                      ? "border-primary text-text"
                      : "border-transparent text-faint hover:text-muted",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6">
          {loading && tab === "files" && (
            <div className="flex items-center gap-2 py-12 text-sm text-muted" role="status">
              <Spinner /> 設定ファイルを読み込み中
            </div>
          )}
          {error && (
            <p
              className="mb-4 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger"
              role="alert"
            >
              {error}
            </p>
          )}
          {message && (
            <p
              className="mb-4 rounded-xl border border-success/30 bg-success-bg px-4 py-3 text-sm text-success"
              role="status"
            >
              {message}
            </p>
          )}

          {tab === "files" && data && selected && (
            <div className="grid gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
              <nav aria-label="プロジェクト設定ファイル" className="space-y-1">
                {data.files.map((file) => (
                  <button
                    key={file.key}
                    type="button"
                    onClick={() => selectFile(file.key)}
                    className={cx(
                      "flex w-full cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                      activeFile === file.key
                        ? "border-primary bg-primary/10"
                        : "border-transparent hover:bg-surface-2",
                    )}
                  >
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text">
                        {file.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-faint">
                        {file.exists ? "既存ファイル" : "未作成"}
                      </span>
                    </span>
                  </button>
                ))}
              </nav>

              <section className="min-w-0 rounded-xl border border-border bg-surface p-4">
                <div className="mb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-mono text-sm font-semibold text-text">{selected.key}</h2>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-faint">
                      {selected.exists ? "編集中" : "保存時に新規作成"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-faint">{selected.description}</p>
                </div>
                <textarea
                  aria-label={`${selected.label}の内容`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  spellCheck={false}
                  className="min-h-[28rem] w-full resize-y rounded-lg border border-border bg-bg px-3 py-3 font-mono text-xs leading-5 text-text outline-none focus:border-primary"
                />
                <div className="mt-3 flex justify-end">
                  <Button type="button" variant="primary" busy={saving} onClick={() => void saveFile()}>
                    {selected.label}を保存
                  </Button>
                </div>
              </section>
            </div>
          )}

          {tab === "agents" && (
            <div className="grid gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
              <nav aria-label="プロジェクトサブエージェント" className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                    aria-label="新規サブエージェント名"
                    placeholder="新しいエージェント名"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void createAgent();
                    }}
                  />
                  <button
                    type="button"
                    aria-label="サブエージェントを作成"
                    title="サブエージェントを作成"
                    disabled={creatingAgent || !newAgentName.trim()}
                    onClick={() => void createAgent()}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {agents.map((agent) => (
                  <div
                    key={agent.name}
                    className={cx(
                      "flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors",
                      activeAgent === agent.name
                        ? "border-primary bg-primary/10"
                        : "border-transparent hover:bg-surface-2",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => selectAgent(agent.name)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                    >
                      <Users className="h-3.5 w-3.5 shrink-0 text-muted" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-text">
                          {agent.name}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-faint">
                          {agent.relativePath}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`サブエージェント「${agent.name}」を削除`}
                      title="削除"
                      disabled={saving}
                      onClick={() => void removeAgent(agent.name)}
                      className="shrink-0 rounded-lg p-1.5 text-faint hover:bg-danger-bg hover:text-danger disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {agents.length === 0 && (
                  <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-faint">
                    サブエージェントがありません
                  </p>
                )}
              </nav>

              <section className="min-w-0 rounded-xl border border-border bg-surface p-4">
                {selectedAgent ? (
                  <>
                    <div className="mb-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="font-mono text-sm font-semibold text-text">
                          {selectedAgent.name}
                        </h2>
                        <Badge tone="neutral">.opencode/agents</Badge>
                      </div>
                      <p className="mt-1 truncate font-mono text-[11px] text-faint">
                        {selectedAgent.relativePath}
                      </p>
                    </div>
                    <textarea
                      aria-label={`サブエージェント「${selectedAgent.name}」の内容`}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      spellCheck={false}
                      className="min-h-[28rem] w-full resize-y rounded-lg border border-border bg-bg px-3 py-3 font-mono text-xs leading-5 text-text outline-none focus:border-primary"
                    />
                    <div className="mt-3 flex justify-end">
                      <Button type="button" variant="primary" busy={saving} onClick={() => void saveAgent()}>
                        サブエージェントを保存
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="py-12 text-center text-sm text-faint">
                    左の「+」からサブエージェントを作成してください
                  </p>
                )}
              </section>
            </div>
          )}

          {tab === "skills" && (
            <div className="grid gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
              <nav aria-label="プロジェクトスキル" className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSkillName}
                    onChange={(event) => setNewSkillName(event.target.value)}
                    aria-label="新規スキル名"
                    placeholder="新しいスキル名"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void createSkill();
                    }}
                  />
                  <button
                    type="button"
                    aria-label="スキルを作成"
                    title="スキルを作成"
                    disabled={creatingSkill || !newSkillName.trim()}
                    onClick={() => void createSkill()}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {skills.map((skill) => {
                  const fields = parseFrontmatterFields(skill.content);
                  const overview =
                    fields.description_ja || fields.description || undefined;
                  return (
                  <div
                    key={skill.name}
                    className={cx(
                      "flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors",
                      activeSkill === skill.name
                        ? "border-primary bg-primary/10"
                        : "border-transparent hover:bg-surface-2",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => selectSkill(skill.name)}
                      title={overview}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                    >
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-accent">
                          {skill.name}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-faint">
                          {skill.relativePath}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`スキル「${skill.name}」を削除`}
                      title="削除"
                      disabled={saving}
                      onClick={() => void removeSkill(skill.name)}
                      className="shrink-0 rounded-lg p-1.5 text-faint hover:bg-danger-bg hover:text-danger disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  );
                })}
                {skills.length === 0 && (
                  <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-faint">
                    スキルがありません
                  </p>
                )}
              </nav>

              <section className="min-w-0 rounded-xl border border-border bg-surface p-4">
                {selectedSkill ? (
                  <>
                    <div className="mb-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="font-mono text-sm font-semibold text-text">
                          {selectedSkill.name}
                        </h2>
                        <Badge tone="neutral">.opencode/skills</Badge>
                      </div>
                      <p className="mt-1 truncate font-mono text-[11px] text-faint">
                        {selectedSkill.relativePath}
                      </p>
                    </div>
                    <textarea
                      aria-label={`スキル「${selectedSkill.name}」の内容`}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      spellCheck={false}
                      className="min-h-[28rem] w-full resize-y rounded-lg border border-border bg-bg px-3 py-3 font-mono text-xs leading-5 text-text outline-none focus:border-primary"
                    />
                    <div className="mt-3 flex justify-end">
                      <Button type="button" variant="primary" busy={saving} onClick={() => void saveSkill()}>
                        スキルを保存
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="py-12 text-center text-sm text-faint">
                    左の「+」からスキルを作成してください
                  </p>
                )}
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
