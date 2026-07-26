import path from "node:path";
import { dataDir } from "./paths";
import {
  ProjectRow,
  bindSession,
  getProject,
  importWorkspaceRow,
  getWorkspace,
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
 * Bridges the global SQLite DB and the machine-local manifest under
 * `<dataDir>/projects/<key>/sessions.json` so session bindings can be resumed
 * after a close/reopen and survive a DB reset. Bindings are intentionally not
 * stored in the repository (spec change 2026-07-25): they follow the machine,
 * not a clone. All operations are best-effort and never throw into the
 * caller's request path.
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

/** Rebuild the project's manifest from DB truth and write it to the machine-local data dir. */
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

/** True when `child` is strictly nested inside `parent` (root coincidence rejected). */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  // Reject root coincidence so a crafted manifest cannot drive recursive
  // delete of the repo root or a worktree base itself.
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function isSamePath(left: string, right: string): boolean {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

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
      // A git worktree we provisioned lives either under the project root
      // (legacy <repoRoot>/.webui-worktrees/…) or under the machine-local
      // data dir (<dataDir>/worktrees/…, OneDrive-safe location). Manifests
      // are machine-local now, so a crafted in-repo sessions.json is never
      // read; this guard remains defense-in-depth against a tampered
      // machine-local manifest — a worktreePath pointing elsewhere must not
      // be imported, since destroying it would drive a recursive delete
      // outside the repo.
      const worktreeBase = path.resolve(dataDir(), "worktrees");
      if (
        ws.isolation === "git_worktree" &&
        ws.worktreePath &&
        (isSamePath(ws.worktreePath, rootPath) ||
          isSamePath(ws.worktreePath, worktreeBase))
      ) {
        log(`restore ${rootPath}`, `skipped workspace ${ws.id}: worktreePath is a protected root`);
        continue;
      }
      if (
        ws.isolation === "git_worktree" &&
        ws.worktreePath &&
        !isInside(rootPath, ws.worktreePath) &&
        !isInside(worktreeBase, ws.worktreePath)
      ) {
        log(`restore ${rootPath}`, `skipped workspace ${ws.id}: worktreePath escapes root`);
        continue;
      }
      // temporary_copy paths must be exactly <dataDir>/copies/<workspaceId>.
      // A crafted worktreePath pointing at an allowlisted project root would
      // later drive removeAllowedRoot on destroy when the folder is missing.
      const copiesBase = path.resolve(dataDir(), "copies");
      if (ws.isolation === "temporary_copy") {
        if (!ws.worktreePath) {
          log(`restore ${rootPath}`, `skipped workspace ${ws.id}: missing temporary copy path`);
          continue;
        }
        const resolvedCopy = path.resolve(ws.worktreePath);
        if (
          path.dirname(resolvedCopy) !== copiesBase ||
          path.basename(resolvedCopy) !== ws.id ||
          isSamePath(resolvedCopy, copiesBase)
        ) {
          log(
            `restore ${rootPath}`,
            `skipped workspace ${ws.id}: temporary copy path escapes copies root`,
          );
          continue;
        }
      }
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
      if (inserted) {
        result.workspaces += 1;
      } else {
        // ID collision with another project's workspace: never bind sessions
        // onto a foreign row (machine-local manifests are keyed per root, but
        // a tampered manifest could still reuse a foreign workspace id).
        const existing = getWorkspace(ws.id);
        if (!existing || existing.project_id !== projectId) {
          log(
            `restore ${rootPath}`,
            `skipped sessions for workspace ${ws.id}: id already owned by another project`,
          );
          continue;
        }
      }
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

/** Restore every known project (by DB root path) from its machine-local manifest. */
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
 * the machine-local manifest. Used when (re)opening a repository so its
 * sessions come back even if the global DB was cleared.
 */
export function adoptProjectFromManifest(rootPath: string): {
  project: ProjectRow;
  restored: RestoreResult;
} | null {
  const manifest = readProjectManifest(rootPath);
  // No manifest → nothing to adopt. Returning null keeps the /restore route's
  // 404 branch live and avoids registering a project (and allow-listing its
  // path) for a directory the user never actually opened.
  if (!manifest) return null;
  const name = manifest.project.name;
  const project = upsertProject({
    name: name || rootPath.split(/[\\/]/).filter(Boolean).pop() || "Project",
    rootPath,
  });
  const restored = restoreProjectFromManifest(rootPath, project.id);
  return { project, restored };
}
