import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { createWorkspace, getDb, listWorkspaces } from "@/lib/db";
import { addWorktree } from "@/lib/git";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugBranch(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `webui/${base || "ws"}-${Date.now().toString(36)}`;
}

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  const rows = listWorkspaces(projectId).map((w) => ({
    id: w.id,
    projectId: w.project_id,
    displayName: w.display_name,
    absolutePath: w.absolute_path,
    isolation: w.isolation,
    baseBranch: w.base_branch,
    worktreePath: w.worktree_path,
    status: w.status,
    createdAt: w.created_at,
  }));
  return NextResponse.json({ workspaces: rows });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    projectId?: string;
    displayName?: string;
    absolutePath?: string;
    isolation?: "current_folder" | "git_worktree";
    baseBranch?: string;
    branch?: string;
  } | null;

  if (!body?.projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const isolation = body.isolation ?? "current_folder";
  if (isolation !== "current_folder" && isolation !== "git_worktree") {
    return NextResponse.json({ error: "invalid isolation" }, { status: 400 });
  }

  const project = getDb()
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(body.projectId) as { id: string; root_path: string; name: string } | undefined;
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const rootCheck = assertAllowedDirectory(project.root_path);
  if (!rootCheck.ok) {
    return NextResponse.json({ error: rootCheck.error }, { status: rootCheck.status });
  }

  const displayName =
    body.displayName?.trim() ||
    (isolation === "git_worktree"
      ? "Worktree session"
      : path.basename(project.root_path));

  let absolutePath = body.absolutePath
    ? path.resolve(body.absolutePath)
    : path.resolve(project.root_path);
  let worktreePath: string | undefined;
  const baseBranch: string | undefined = body.baseBranch;

  if (isolation === "git_worktree") {
    const branch = body.branch?.trim() || slugBranch(displayName);
    const wtDir = path.join(
      project.root_path,
      ".webui-worktrees",
      branch.replace(/\//g, "__"),
    );
    try {
      await addWorktree({
        repoRoot: project.root_path,
        worktreePath: wtDir,
        branch,
        baseBranch: body.baseBranch,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "worktree add failed" },
        { status: 500 },
      );
    }
    absolutePath = wtDir;
    worktreePath = wtDir;
  }

  const pathCheck = assertAllowedDirectory(absolutePath);
  if (!pathCheck.ok) {
    return NextResponse.json({ error: pathCheck.error }, { status: pathCheck.status });
  }

  const row = createWorkspace({
    projectId: body.projectId,
    displayName,
    absolutePath,
    isolation,
    baseBranch,
    worktreePath,
  });

  return NextResponse.json({
    workspace: {
      id: row.id,
      projectId: row.project_id,
      displayName: row.display_name,
      absolutePath: row.absolute_path,
      isolation: row.isolation,
      baseBranch: row.base_branch,
      worktreePath: row.worktree_path,
      status: row.status,
      createdAt: row.created_at,
    },
  });
}
