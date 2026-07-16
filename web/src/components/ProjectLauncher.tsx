"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

export type Project = {
  id: string;
  name: string;
  rootPath: string;
  favorite: boolean;
  lastOpenedAt: string | null;
};

export type Workspace = {
  id: string;
  projectId: string;
  displayName: string;
  absolutePath: string;
  isolation: "current_folder" | "git_worktree";
  status: string;
  createdAt: string;
};

type Props = {
  onOpenWorkspace: (ws: Workspace, project: Project) => void;
};

export function ProjectLauncher({ onOpenWorkspace }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [rootPath, setRootPath] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [isolation, setIsolation] = useState<"current_folder" | "git_worktree">(
    "git_worktree",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshProjects = useCallback(async () => {
    const res = await fetch("/api/projects", { cache: "no-store" });
    const data = (await res.json()) as { projects: Project[] };
    setProjects(data.projects ?? []);
    if (!selectedProjectId && data.projects?.[0]) {
      setSelectedProjectId(data.projects[0].id);
    }
  }, [selectedProjectId]);

  const refreshWorkspaces = useCallback(async (projectId: string | null) => {
    if (!projectId) {
      setWorkspaces([]);
      return;
    }
    const res = await fetch(`/api/workspaces?projectId=${encodeURIComponent(projectId)}`, {
      cache: "no-store",
    });
    const data = (await res.json()) as { workspaces: Workspace[] };
    setWorkspaces(data.workspaces ?? []);
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    void refreshWorkspaces(selectedProjectId);
  }, [selectedProjectId, refreshWorkspaces]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const addProject = async (e: FormEvent) => {
    e.preventDefault();
    if (!rootPath.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rootPath: rootPath.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `failed: ${res.status}`);
        return;
      }
      setRootPath("");
      await refreshProjects();
      setSelectedProjectId(data.project.id);
    } finally {
      setBusy(false);
    }
  };

  const createAndOpen = async () => {
    if (!selectedProject) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProject.id,
          displayName: sessionName.trim() || undefined,
          isolation,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `workspace failed: ${res.status}`);
        return;
      }
      onOpenWorkspace(data.workspace as Workspace, selectedProject);
    } finally {
      setBusy(false);
    }
  };

  const removeWorkspace = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `delete failed: ${res.status}`);
        return;
      }
      await refreshWorkspaces(selectedProjectId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-4 py-8 text-[#e7ecf1]">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Project Launcher</h1>
        <p className="mt-1 text-sm text-white/55">
          プロジェクトを選び、Workspace（Session）を作成してチャットを開きます。
        </p>
      </header>

      <form onSubmit={(e) => void addProject(e)} className="flex flex-col gap-2 sm:flex-row">
        <input
          className="min-h-12 flex-1 rounded-md border border-white/15 bg-black/30 px-3 text-sm outline-none focus:border-sky-500"
          placeholder="C:\\path\\to\\repo"
          value={rootPath}
          onChange={(e) => setRootPath(e.target.value)}
        />
        <button
          type="submit"
          disabled={busy || !rootPath.trim()}
          className="min-h-12 rounded-md bg-sky-600 px-4 text-sm font-semibold disabled:opacity-40"
        >
          Add Project
        </button>
      </form>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-white/10 bg-white/5 p-3">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/45">
            Projects
          </h2>
          <ul className="space-y-1">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedProjectId(p.id)}
                  className={`min-h-12 w-full rounded-md px-3 text-left text-sm ${
                    selectedProjectId === p.id
                      ? "bg-sky-600/30"
                      : "bg-black/20 hover:bg-white/10"
                  }`}
                >
                  <div className="font-medium">{p.name}</div>
                  <div className="truncate text-xs text-white/40">{p.rootPath}</div>
                </button>
              </li>
            ))}
            {projects.length === 0 && (
              <li className="px-2 py-6 text-sm text-white/35">No projects yet</li>
            )}
          </ul>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/5 p-3">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/45">
            Workspaces
          </h2>
          <ul className="mb-4 space-y-1">
            {workspaces.map((w) => (
              <li
                key={w.id}
                className="flex items-stretch gap-1 rounded-md bg-black/20"
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => selectedProject && onOpenWorkspace(w, selectedProject)}
                  className="min-h-12 flex-1 px-3 text-left text-sm hover:bg-white/10"
                >
                  <div className="font-medium">{w.displayName}</div>
                  <div className="text-xs text-white/40">
                    {w.isolation}
                    {w.status !== "active" ? ` · ${w.status}` : ""}
                  </div>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeWorkspace(w.id)}
                  className="min-h-12 px-3 text-xs text-red-200 hover:bg-red-900/40"
                >
                  Del
                </button>
              </li>
            ))}
            {selectedProject && workspaces.length === 0 && (
              <li className="px-2 py-4 text-sm text-white/35">No workspaces</li>
            )}
          </ul>

          <div className="space-y-2 border-t border-white/10 pt-3">
            <label className="block text-xs text-white/45">New session</label>
            <input
              className="min-h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm outline-none focus:border-sky-500"
              placeholder="Session name"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              disabled={!selectedProject}
            />
            <div className="flex gap-3 text-sm">
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="iso"
                  checked={isolation === "git_worktree"}
                  onChange={() => setIsolation("git_worktree")}
                />
                Git Worktree
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="iso"
                  checked={isolation === "current_folder"}
                  onChange={() => setIsolation("current_folder")}
                />
                Current Folder
              </label>
            </div>
            <button
              type="button"
              disabled={!selectedProject || busy}
              onClick={() => void createAndOpen()}
              className="min-h-12 w-full rounded-md bg-emerald-600 text-sm font-semibold disabled:opacity-40"
            >
              Create & Open
            </button>
          </div>
        </section>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}
    </div>
  );
}
