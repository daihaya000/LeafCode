import {
  ProjectRow,
  bindSession,
  getProject,
  importWorkspaceRow,
  listProjects,
  listSessionBindings,
  listWorkspaces,
  upsertProject,
} from "./db";
import {
  ManifestWorkspace,
  ProjectSessionManifest,
  emptyManifest,
  readProjectManifest,
  writeProjectManifest,
} from "./project-session-store";

/**
 * Bridges the global SQLite DB and the project-local manifest so session
 * bindings live "inside the repository" and can be resumed after a close/reopen
 * (or restored on a fresh machine / clone). All operations are best-effort and
 * never throw into the caller's request path.
 */

function log(scope: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[project-session-sync] ${scope}: ${msg}`);
}

function manifestFromDb(project: ProjectRow): ProjectSessionManifest {
  const manifest = emptyManifest({
    name: project.name,
    rootPath: project.root_path,
  });
  const workspaces = listWorkspaces(project.id);
  const wsEntries: ManifestWorkspace[] = workspaces.map((ws) => ({
    id: ws.id,
    displayName: ws.display_name,
    absolutePath: ws.absolute_path,
    isolation: ws.isolation,
    baseBranch: ws.base_branch,
    worktreePath: ws.worktree_path,
    status: ws.status,
    createdAt: ws.created_at,
    sessions: listSessionBindings(ws.id).map((b) => ({
      opencodeSessionId: b.opencode_session_id,
      title: b.title,
      updatedAt: b.updated_at,
    })),
  }));
  return { ...manifest, workspaces: wsEntries, updatedAt: new Date().toISOString() };
}

/** Rebuild the project's manifest from DB truth and write it into the repo. */
export function persistProjectSessions(projectId: string): void {
  try {
    const project = getProject(projectId);
    if (!project) return;
    const manifest = manifestFromDb(project);
    writeProjectManifest(project.root_path, manifest);
  } catch (err) {
    log(`persist ${projectId}`, err);
  }
}

export type RestoreResult = {
  workspaces: number;
  sessions: number;
};

const isolations = new Set([
  "current_folder",
  "git_worktree",
  "temporary_copy",
  "devcontainer",
]);
const statuses = new Set(["active", "merging", "archived", "orphaned"]);

/**
 * Import any workspaces/sessions present in a project's manifest but missing
 * from the DB. Idempotent: existing rows are left untouched.
 */
export function restoreProjectFromManifest(
  rootPath: string,
  projectId: string,
): RestoreResult {
  const result: RestoreResult = { workspaces: 0, sessions: 0 };
  try {
    const manifest = readProjectManifest(rootPath);
    if (!manifest) return result;
    for (const ws of manifest.workspaces) {
      const isolation = isolations.has(ws.isolation)
        ? (ws.isolation as "current_folder")
        : "current_folder";
      const status = statuses.has(ws.status)
        ? (ws.status as "active")
        : "active";
      const inserted = importWorkspaceRow({
        id: ws.id,
        projectId,
        displayName: ws.displayName,
        absolutePath: ws.absolutePath,
        isolation,
        baseBranch: ws.baseBranch,
        worktreePath: ws.worktreePath,
        status,
        createdAt: ws.createdAt,
      });
      if (inserted) result.workspaces += 1;
      for (const s of ws.sessions) {
        bindSession(ws.id, s.opencodeSessionId, s.title, s.updatedAt);
        result.sessions += 1;
      }
    }
  } catch (err) {
    log(`restore ${rootPath}`, err);
  }
  return result;
}

/** Restore every known project (by DB root path) from its repo manifest. */
export function restoreAllKnownProjects(): RestoreResult {
  const total: RestoreResult = { workspaces: 0, sessions: 0 };
  for (const project of listProjects()) {
    const r = restoreProjectFromManifest(project.root_path, project.id);
    total.workspaces += r.workspaces;
    total.sessions += r.sessions;
  }
  return total;
}

/**
 * Register a project by its root path (upsert) and restore its sessions from
 * the repo manifest. Used when (re)opening a repository so its sessions come
 * back even if the global DB was cleared.
 */
export function adoptProjectFromManifest(rootPath: string): {
  project: ProjectRow;
  restored: RestoreResult;
} | null {
  const manifest = readProjectManifest(rootPath);
  const name = manifest?.project.name;
  const project = upsertProject({
    name: name || rootPath.split(/[\\/]/).filter(Boolean).pop() || "Project",
    rootPath,
  });
  const restored = restoreProjectFromManifest(rootPath, project.id);
  return { project, restored };
}
