import fs from "node:fs";
import path from "node:path";
import { assertAllowedDirectory } from "./allowlist";
import { createTemporaryCopy, removeTemporaryCopy, resolveTemporaryCopyPath } from "./copy";
import { detectDevcontainer } from "./devcontainer";
import {
  WorkspaceRow,
  addAllowedRoot,
  createWorkspace,
  deleteProject,
  deleteWorkspace,
  getDb,
  getWorkspace,
  listProjects,
  listSessionBindings,
  listWorkspaces,
  removeAllowedRoot,
  setWorkspaceStatus,
} from "./db";
import { addWorktree, removeWorktree, runGit } from "./git";
import { ocServer } from "./oc-server";
import { openCodeSessionPath } from "./opencode-id";
import { dataDir, ensureDataDir } from "./paths";
import { persistProjectSessions } from "./project-session-sync";
import { deleteProjectManifest } from "./project-session-store";
import { makeWorktreeBranchName } from "./workspace-branch";

/**
 * Resolve the worktree directory for a new git worktree session.
 *
 * Historically worktrees lived under `<repoRoot>/.webui-worktrees/…`. When the
 * repo root is inside a OneDrive-synced folder, OneDrive's Cloud Files reparse
 * point locks the worktree directory so `git worktree remove` / `fs.rmSync`
 * fail with EPERM, leaving every workspace orphaned ("要復旧"). Place new
 * worktrees under the machine-local data dir (outside OneDrive) so removal
 * succeeds reliably. Existing DB rows keep their original `worktree_path` for
 * backward compatibility.
 */
export function resolveWorktreeDir(projectId: string, branchSlug: string): string {
  ensureDataDir();
  const base = path.join(dataDir(), "worktrees", projectId);
  fs.mkdirSync(base, { recursive: true });
  return path.join(base, branchSlug);
}

export type Isolation =
  | "current_folder"
  | "git_worktree"
  | "temporary_copy"
  | "devcontainer";

export class ServiceError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export { makeWorktreeBranchName } from "./workspace-branch";

export function isIsolation(value: unknown): value is Isolation {
  return (
    value === "current_folder" ||
    value === "git_worktree" ||
    value === "temporary_copy" ||
    value === "devcontainer"
  );
}

/** Create the working directory (worktree/copy) + workspace row. */
export async function provisionWorkspace(input: {
  projectId: string;
  displayName?: string;
  isolation: Isolation;
  baseBranch?: string;
  branch?: string;
}): Promise<{ workspace: WorkspaceRow; note?: string }> {
  const project = getDb()
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(input.projectId) as
    | { id: string; root_path: string; name: string }
    | undefined;
  if (!project) throw new ServiceError("project not found", 404);

  const rootCheck = assertAllowedDirectory(project.root_path);
  if (!rootCheck.ok) throw new ServiceError(rootCheck.error, rootCheck.status);

  const isolation = input.isolation;
  const displayName =
    input.displayName?.trim() ||
    (isolation === "git_worktree"
      ? "Worktree session"
      : isolation === "temporary_copy"
        ? "Temp copy session"
        : isolation === "devcontainer"
          ? "Dev Container (host)"
          : path.basename(project.root_path));

  // Never trust a client-supplied absolutePath. current_folder / devcontainer
  // bind to the project root; git_worktree / temporary_copy set their own
  // provisioned paths below (mirrors restoreProjectFromManifest).
  let absolutePath = path.resolve(project.root_path);
  let worktreePath: string | undefined;
  const workspaceId = crypto.randomUUID();
  let note: string | undefined;

  if (isolation === "devcontainer") {
    const info = detectDevcontainer(project.root_path);
    if (!info.present) throw new ServiceError(info.message, 400);
    note = info.message;
  }

  if (isolation === "git_worktree") {
    const branch =
      input.branch?.trim() ||
      makeWorktreeBranchName({
        displayName,
        workspaceId,
        baseBranch: input.baseBranch,
      });
    const wtDir = resolveWorktreeDir(
      input.projectId,
      branch.replace(/\//g, "__"),
    );
    try {
      await addWorktree({
        repoRoot: project.root_path,
        worktreePath: wtDir,
        branch,
        baseBranch: input.baseBranch,
      });
    } catch (err) {
      throw new ServiceError(
        err instanceof Error ? err.message : "worktree add failed",
        500,
      );
    }
    absolutePath = wtDir;
    worktreePath = wtDir;
  }

  if (isolation === "temporary_copy") {
    try {
      absolutePath = createTemporaryCopy(project.root_path, workspaceId);
      worktreePath = absolutePath;
      addAllowedRoot(absolutePath);
    } catch (err) {
      // createTemporaryCopy rolls back its partial directory. If allowlisting
      // failed after the copy was created, remove precisely that copy and its
      // allowlist entry. Keep these independent so a failed DB cleanup cannot
      // leave the on-disk copy orphaned.
      if (worktreePath) {
        try {
          removeAllowedRoot(worktreePath);
        } catch {
          /* best effort rollback */
        }
        try {
          removeTemporaryCopy(worktreePath, workspaceId);
        } catch {
          /* best effort rollback */
        }
      }
      throw new ServiceError(
        err instanceof Error ? err.message : "temporary copy failed",
        500,
      );
    }
  }

  const pathCheck = assertAllowedDirectory(absolutePath);
  if (!pathCheck.ok) throw new ServiceError(pathCheck.error, pathCheck.status);

  const row = createWorkspace({
    id: isolation === "temporary_copy" ? workspaceId : undefined,
    projectId: input.projectId,
    displayName,
    absolutePath,
    isolation,
    baseBranch: input.baseBranch,
    worktreePath,
  });

  persistProjectSessions(input.projectId);
  return { workspace: row, note };
}

/**
 * Delete OpenCode engine sessions bound to an isolated workspace before the
 * on-disk directory disappears. Skipping this leaves session.directory pointing
 * at a deleted worktree; cursor-agent then fails with
 * "Workspace directory does not exist". Best-effort: disk cleanup continues
 * even if the engine is down. current_folder / devcontainer share a durable
 * directory, so their OpenCode sessions are left alone.
 */
async function deleteBoundOpenCodeSessions(row: WorkspaceRow): Promise<void> {
  if (row.isolation !== "git_worktree" && row.isolation !== "temporary_copy") {
    return;
  }
  const directory = row.absolute_path;
  const bindings = listSessionBindings(row.id);
  await Promise.all(
    bindings.map((b) => {
      try {
        return ocServer(directory, openCodeSessionPath(b.opencode_session_id), {
          method: "DELETE",
        }).catch(() => undefined);
      } catch {
        // Unsafe id (e.g. crafted manifest) — never forward to the engine.
        return Promise.resolve();
      }
    }),
  );
}

/** Set workspace status to "archived". Worktree/sessions are preserved. */
export async function archiveWorkspace(id: string): Promise<void> {
  const row = getWorkspace(id);
  if (!row) throw new ServiceError("workspace not found", 404);
  setWorkspaceStatus(id, "archived");
  persistProjectSessions(row.project_id);
}

/** Restore an archived workspace back to "active". */
export async function restoreWorkspace(id: string): Promise<void> {
  const row = getWorkspace(id);
  if (!row) throw new ServiceError("workspace not found", 404);
  setWorkspaceStatus(id, "active");
  persistProjectSessions(row.project_id);
}

/** Remove worktree/copy and metadata. Marks orphaned + throws 409 on disk failure. */
export async function destroyWorkspace(id: string): Promise<WorkspaceRow> {
  const row = getWorkspace(id);
  if (!row) throw new ServiceError("workspace not found", 404);

  await deleteBoundOpenCodeSessions(row);

  const project = getDb()
    .prepare("SELECT root_path FROM projects WHERE id = ?")
    .get(row.project_id) as { root_path: string } | undefined;

  if (row.isolation === "git_worktree" && row.worktree_path && project) {
    const wt = path.resolve(row.worktree_path);
    try {
      await removeWorktree({
        repoRoot: project.root_path,
        worktreePath: row.worktree_path,
        force: true,
      });
    } catch (err) {
      // Folder already gone (or removed mid-failure) → treat as cleaned
      if (!fs.existsSync(wt)) {
        await runGit(project.root_path, [
          "worktree",
          "prune",
          "--expire",
          "now",
        ]).catch(() => undefined);
      } else {
        setWorkspaceStatus(id, "orphaned");
        const detail = err instanceof Error ? err.message : String(err);
        throw new ServiceError(
          `git worktree remove failed; marked orphaned (${detail})`,
          409,
        );
      }
    }
  }

  if (row.isolation === "temporary_copy" && row.worktree_path) {
    let trustedPath: string;
    try {
      trustedPath = resolveTemporaryCopyPath(row.worktree_path, row.id);
    } catch {
      // Tampered / migrated path outside copies/<id>: drop the DB row only.
      // Never call removeAllowedRoot on an untrusted path (could erase a real
      // project root from the allowlist when the folder is already gone).
      deleteWorkspace(id);
      persistProjectSessions(row.project_id);
      return row;
    }
    try {
      removeTemporaryCopy(trustedPath, row.id);
    } catch {
      if (fs.existsSync(trustedPath)) {
        setWorkspaceStatus(id, "orphaned");
        throw new ServiceError(
          "temporary copy remove failed; marked orphaned",
          409,
        );
      }
    }
    // The copy path was allow-listed when provisioned; drop it now that the
    // folder is gone so allowed_roots doesn't accumulate dead entries.
    removeAllowedRoot(trustedPath);
  }

  deleteWorkspace(id);
  persistProjectSessions(row.project_id);
  return row;
}

/** Destroy all workspaces for a project, then delete the project row. */
export async function destroyProject(projectId: string): Promise<{
  destroyed: number;
  orphaned: number;
  errors: string[];
}> {
  const project = getDb()
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(projectId) as { id: string; root_path: string } | undefined;
  if (!project) throw new ServiceError("project not found", 404);

  const workspaces = listWorkspaces(projectId);
  let destroyed = 0;
  let orphaned = 0;
  const errors: string[] = [];

  for (const ws of workspaces) {
    try {
      await destroyWorkspace(ws.id);
      destroyed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${ws.display_name}: ${msg}`);
      const still = getWorkspace(ws.id);
      if (still?.status === "orphaned") orphaned += 1;
    }
  }

  const remaining = listWorkspaces(projectId);
  if (remaining.length > 0) {
    throw new ServiceError(
      `プロジェクトを削除できません。残タスク ${remaining.length} 件（${errors.join("; ") || "orphan"}）`,
      409,
    );
  }

  deleteProject(projectId);

  const others = listProjects().filter((p) => p.root_path === project.root_path);
  if (others.length === 0) {
    removeAllowedRoot(project.root_path);
    // Drop machine-local sessions so /api/projects/restore cannot resurrect
    // the allowlist entry without an explicit POST /api/projects re-add.
    deleteProjectManifest(project.root_path);
  }

  return { destroyed, orphaned, errors };
}
