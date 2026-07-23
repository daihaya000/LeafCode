import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  deleteWorkspace,
  getDb,
  listWorkspacesByStatus,
  removeAllowedRoot,
  setWorkspaceStatus,
} from "@/lib/db";
import { listGitWorktrees, removeWorktree, runGit } from "@/lib/git";
import { dataDir } from "@/lib/paths";
import { persistProjectSessions } from "@/lib/project-session-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** True when `child` is the same as, or nested inside, `parent`. */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function mapWorkspace(w: {
  id: string;
  project_id: string;
  display_name: string;
  absolute_path: string;
  isolation: string;
  worktree_path: string | null;
  status: string;
  created_at: string;
}) {
  return {
    id: w.id,
    projectId: w.project_id,
    displayName: w.display_name,
    absolutePath: w.absolute_path,
    isolation: w.isolation,
    worktreePath: w.worktree_path,
    status: w.status,
    createdAt: w.created_at,
  };
}

/** Mark active workspaces orphaned when path/worktree is missing. */
async function scanAndMark(): Promise<number> {
  const rows = getDb()
    .prepare(`SELECT * FROM workspaces WHERE status = 'active'`)
    .all() as {
    id: string;
    absolute_path: string;
    worktree_path: string | null;
    isolation: string;
  }[];

  let marked = 0;
  for (const row of rows) {
    const target = row.worktree_path || row.absolute_path;
    if (!fs.existsSync(target)) {
      setWorkspaceStatus(row.id, "orphaned");
      marked += 1;
    }
  }
  return marked;
}

/**
 * Drop orphan DB rows whose folders are already gone (heal after partial deletes).
 * Also prune git worktree metadata when possible.
 */
async function purgeGoneOrphans(): Promise<number> {
  const orphans = listWorkspacesByStatus("orphaned");
  let purged = 0;
  for (const row of orphans) {
    const target = row.worktree_path || row.absolute_path;
    if (fs.existsSync(target)) continue;

    const project = getDb()
      .prepare("SELECT root_path FROM projects WHERE id = ?")
      .get(row.project_id) as { root_path: string } | undefined;

    if (project?.root_path) {
      await runGit(project.root_path, [
        "worktree",
        "prune",
        "--expire",
        "now",
      ]).catch(() => undefined);
      if (row.worktree_path) {
        const admin = path.join(
          project.root_path,
          ".git",
          "worktrees",
          path.basename(row.worktree_path),
        );
        try {
          if (fs.existsSync(admin)) {
            fs.rmSync(admin, { recursive: true, force: true, maxRetries: 3 });
          }
        } catch {
          /* best effort */
        }
      }
    }

    // Release allowlist for temporary_copy orphans (the copy path was
    // allowlisted on provision; drop it now that the folder is gone).
    if (row.isolation === "temporary_copy" && row.worktree_path) {
      try {
        removeAllowedRoot(row.worktree_path);
      } catch {
        /* best effort */
      }
    }

    deleteWorkspace(row.id);
    // Rewrite the repo manifest from DB truth so the purged workspace doesn't
    // get re-imported (and resurrected) next time the project is opened.
    persistProjectSessions(row.project_id);
    purged += 1;
  }
  return purged;
}

type StrayEntry = { projectId: string; projectName: string; path: string };

/**
 * Find git worktrees we own (under `<dataDir>/worktrees/…` or the legacy
 * `<repoRoot>/.webui-worktrees/…`) that have no matching workspace row. These
 * are pure disk+git residue — e.g. `git worktree add` succeeded but a later
 * step in `provisionWorkspace` (allowlist check, session start) failed before
 * the workspace row was ever created, so nothing will ever call
 * `destroyWorkspace` on them. Read-only: does not mutate anything.
 */
async function findStrayWorktrees(): Promise<StrayEntry[]> {
  const projects = getDb().prepare(`SELECT id, root_path, name FROM projects`).all() as {
    id: string;
    root_path: string;
    name: string;
  }[];

  const stray: StrayEntry[] = [];
  const knownPaths = new Set(
    (
      getDb()
        .prepare(`SELECT absolute_path, worktree_path FROM workspaces`)
        .all() as { absolute_path: string; worktree_path: string | null }[]
    )
      .flatMap((r) =>
        [r.absolute_path, r.worktree_path].filter((p): p is string => Boolean(p)),
      )
      .map((p) => p.replace(/\//g, "\\").toLowerCase()),
  );
  const worktreeBase = path.resolve(dataDir(), "worktrees");

  for (const p of projects) {
    try {
      const wts = await listGitWorktrees(p.root_path);
      for (const wt of wts) {
        if (wt.bare) continue;
        // Legacy location: <repoRoot>/.webui-worktrees/…
        // New location:     <dataDir>/worktrees/…
        const isLegacy = /[\\/]\.webui-worktrees[\\/]/.test(wt.path);
        const isNew = isInside(worktreeBase, wt.path);
        if (!isLegacy && !isNew) continue;
        const key = wt.path.replace(/\//g, "\\").toLowerCase();
        if (!knownPaths.has(key)) {
          stray.push({
            projectId: p.id,
            projectName: p.name,
            path: wt.path,
          });
        }
      }
    } catch {
      /* not a git repo or list failed */
    }
  }

  return stray;
}

/**
 * Remove stray git worktrees found by `findStrayWorktrees`. Uses the same
 * `removeWorktree` helper as `destroyWorkspace` (handles Windows/OneDrive
 * read-only retries), so this is safe to run even when the admin metadata
 * under `<repoRoot>/.git/worktrees/…` is locked by OneDrive.
 */
async function cleanupStrayWorktrees(): Promise<{
  removed: number;
  errors: string[];
}> {
  const strays = await findStrayWorktrees();
  const roots = new Map(
    (
      getDb().prepare(`SELECT id, root_path FROM projects`).all() as {
        id: string;
        root_path: string;
      }[]
    ).map((p) => [p.id, p.root_path]),
  );

  let removed = 0;
  const errors: string[] = [];
  for (const s of strays) {
    const repoRoot = roots.get(s.projectId);
    if (!repoRoot) continue;
    try {
      await removeWorktree({ repoRoot, worktreePath: s.path, force: true });
      removed += 1;
    } catch (err) {
      errors.push(
        `${s.projectName}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { removed, errors };
}

export async function GET(req: NextRequest) {
  const doScan = req.nextUrl.searchParams.get("scan") === "1";
  let marked = 0;
  let purged = 0;
  if (doScan) {
    marked = await scanAndMark();
    purged = await purgeGoneOrphans();
  }

  const orphans = listWorkspacesByStatus("orphaned").map(mapWorkspace);
  const stray = await findStrayWorktrees();

  return NextResponse.json({ orphans, stray, marked, purged });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: "cleanup" | "scan";
    ids?: string[];
  };

  if (body.action === "scan") {
    const marked = await scanAndMark();
    const purged = await purgeGoneOrphans();
    return NextResponse.json({
      marked,
      purged,
      orphans: listWorkspacesByStatus("orphaned").map(mapWorkspace),
    });
  }

  const targets =
    body.ids && body.ids.length > 0
      ? body.ids
          .map((id) =>
            getDb().prepare("SELECT * FROM workspaces WHERE id = ?").get(id),
          )
          .filter(Boolean)
      : listWorkspacesByStatus("orphaned");

  const results: { id: string; ok: boolean; error?: string }[] = [];

  for (const row of targets as {
    id: string;
    project_id: string;
    isolation: string;
    worktree_path: string | null;
    absolute_path: string;
  }[]) {
    const project = getDb()
      .prepare("SELECT root_path FROM projects WHERE id = ?")
      .get(row.project_id) as { root_path: string } | undefined;

    const target = row.worktree_path || row.absolute_path;
    const gone = !fs.existsSync(target);

    if (row.isolation === "git_worktree" && row.worktree_path && project) {
      try {
        await removeWorktree({
          repoRoot: project.root_path,
          worktreePath: row.worktree_path,
          force: true,
        });
      } catch (err) {
        // Path already gone → still drop DB row
        if (!gone && fs.existsSync(row.worktree_path)) {
          results.push({
            id: row.id,
            ok: false,
            error: err instanceof Error ? err.message : "remove failed",
          });
          continue;
        }
        await runGit(project.root_path, [
          "worktree",
          "prune",
          "--expire",
          "now",
        ]).catch(() => undefined);
      }
    }

    if (row.isolation === "temporary_copy" && row.worktree_path) {
      try {
        if (fs.existsSync(row.worktree_path)) {
          const { removeTemporaryCopy } = await import("@/lib/copy");
          removeTemporaryCopy(row.worktree_path, row.id);
        }
      } catch (err) {
        if (fs.existsSync(row.worktree_path)) {
          results.push({
            id: row.id,
            ok: false,
            error: err instanceof Error ? err.message : "copy remove failed",
          });
          continue;
        }
      }
      // The copy path was allow-listed on provision; drop it now that the
      // folder is gone, mirroring destroyWorkspace so allowed_roots doesn't
      // accumulate dead entries.
      removeAllowedRoot(row.worktree_path);
    }

    deleteWorkspace(row.id);
    persistProjectSessions(row.project_id);
    results.push({ id: row.id, ok: true });
  }

  // Bulk "clean everything" (no explicit ids) also sweeps stray git
  // worktrees that have no workspace row at all, so residue left behind by
  // a failed provisionWorkspace step doesn't require manual git surgery.
  let strayRemoved = 0;
  let strayErrors: string[] = [];
  if (!body.ids || body.ids.length === 0) {
    const strayResult = await cleanupStrayWorktrees();
    strayRemoved = strayResult.removed;
    strayErrors = strayResult.errors;
  }

  return NextResponse.json({ results, strayRemoved, strayErrors });
}
