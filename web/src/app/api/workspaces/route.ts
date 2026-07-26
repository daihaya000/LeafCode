import { NextRequest, NextResponse } from "next/server";
import { listWorkspaces } from "@/lib/db";
import {
  ServiceError,
  destroyWorkspace,
  isIsolation,
  provisionWorkspace,
} from "@/lib/workspace-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    isolation?: string;
    baseBranch?: string;
    branch?: string;
  } | null;

  if (!body?.projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }
  const isolation = body.isolation ?? "current_folder";
  if (!isIsolation(isolation)) {
    return NextResponse.json({ error: "invalid isolation" }, { status: 400 });
  }

  try {
    const { workspace: row, note } = await provisionWorkspace({
      projectId: body.projectId,
      displayName: body.displayName,
      isolation,
      baseBranch: body.baseBranch,
      branch: body.branch,
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
      note,
    });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  try {
    await destroyWorkspace(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        {
          error: err.message,
          ...(err.status === 409 ? { status: "orphaned" } : {}),
        },
        { status: err.status },
      );
    }
    throw err;
  }
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    status?: "active" | "merging" | "archived";
  } | null;
  if (!body?.id || !body.status) {
    return NextResponse.json(
      { error: "id and status are required" },
      { status: 400 },
    );
  }
  // "orphaned" is reserved for scan/destroy failure paths. Allowing clients to
  // mark a live worktree orphaned would let orphans cleanup force-delete it.
  const VALID_STATUS = ["active", "merging", "archived"] as const;
  if (!VALID_STATUS.includes(body.status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }
  const { getWorkspace, setWorkspaceStatus } = await import("@/lib/db");
  if (!getWorkspace(body.id)) {
    return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  }
  setWorkspaceStatus(body.id, body.status);
  return NextResponse.json({ ok: true, id: body.id, status: body.status });
}
