import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import {
  deleteWorkspace,
  getDb,
  listWorkspacesByStatus,
  setWorkspaceStatus,
} from "@/lib/db";
import { listGitWorktrees, removeWorktree } from "@/lib/git";

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

/** Mark workspaces orphaned when path/worktree is missing. */
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

export async function GET(req: NextRequest) {
  const doScan = req.nextUrl.searchParams.get("scan") === "1";
  let marked = 0;
  if (doScan) {
    marked = await scanAndMark();
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
    ).flatMap((r) =>
      [r.absolute_path, r.worktree_path].filter((p): p is string => Boolean(p)),
    ),
  );

  for (const p of projects) {
    try {
      const wts = await listGitWorktrees(p.root_path);
      for (const wt of wts) {
        if (wt.bare) continue;
        const normalized = wt.path.replace(/\//g, "\\");
        const isWebui = /[\\/]\.webui-worktrees[\\/]/.test(wt.path);
        if (!isWebui) continue;
        const known =
          knownPaths.has(wt.path) ||
          knownPaths.has(normalized) ||
          [...knownPaths].some(
            (k) => k.toLowerCase() === wt.path.toLowerCase(),
          );
        if (!known) {
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

  return NextResponse.json({ orphans, stray, marked });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: "cleanup" | "scan";
    ids?: string[];
  };

  if (body.action === "scan") {
    const marked = await scanAndMark();
    return NextResponse.json({
      marked,
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
  }[]) {
    const project = getDb()
      .prepare("SELECT root_path FROM projects WHERE id = ?")
      .get(row.project_id) as { root_path: string } | undefined;

    if (row.isolation === "git_worktree" && row.worktree_path && project) {
      try {
        if (fs.existsSync(row.worktree_path)) {
          await removeWorktree({
            repoRoot: project.root_path,
            worktreePath: row.worktree_path,
            force: true,
          });
        }
      } catch (err) {
        results.push({
          id: row.id,
          ok: false,
          error: err instanceof Error ? err.message : "remove failed",
        });
        continue;
      }
    }

    if (row.isolation === "temporary_copy" && row.worktree_path) {
      try {
        const { removeTemporaryCopy } = await import("@/lib/copy");
        if (fs.existsSync(row.worktree_path)) {
          removeTemporaryCopy(row.worktree_path);
        }
      } catch (err) {
        results.push({
          id: row.id,
          ok: false,
          error: err instanceof Error ? err.message : "copy remove failed",
        });
        continue;
      }
    }

    deleteWorkspace(row.id);
    results.push({ id: row.id, ok: true });
  }

  return NextResponse.json({ results });
}
