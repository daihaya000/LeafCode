import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  deleteWorkspace,
  getDb,
  listWorkspacesByStatus,
  setWorkspaceStatus,
} from "@/lib/db";
import { listGitWorktrees, removeWorktree, runGit } from "@/lib/git";
import { persistProjectSessions } from "@/lib/project-session-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    deleteWorkspace(row.id);
    // Rewrite the repo manifest from DB truth so the purged workspace doesn't
    // get re-imported (and resurrected) next time the project is opened.
    persistProjectSessions(row.project_id);
    purged += 1;
  }
  return purged;
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

  // Also surface git worktrees under .webui-worktrees with no DB row
  const projects = getDb().prepare(`SELECT id, root_path, name FROM projects`).all() as {
    id: string;
    root_path: string;
    name: string;
  }[];

  const stray: { projectId: string; projectName: string; path: string }[] = [];
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

  for (const p of projects) {
    try {
      const wts = await listGitWorktrees(p.root_path);
      for (const wt of wts) {
        if (wt.bare) continue;
        const isWebui = /[\\/]\.webui-worktrees[\\/]/.test(wt.path);
        if (!isWebui) continue;
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
          removeTemporaryCopy(row.worktree_path);
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
    }

    deleteWorkspace(row.id);
    persistProjectSessions(row.project_id);
    results.push({ id: row.id, ok: true });
  }

  return NextResponse.json({ results });
}
