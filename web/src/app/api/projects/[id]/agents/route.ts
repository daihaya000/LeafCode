import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import {
  listProjectAgents,
  writeProjectAgent,
} from "@/lib/project-agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectRow = { id: string; name: string; root_path: string };

function getProject(id: string): ProjectRow | undefined {
  return getDb()
    .prepare("SELECT id, name, root_path FROM projects WHERE id = ?")
    .get(id) as ProjectRow | undefined;
}

function resolveProjectRoot(project: ProjectRow): string {
  return fs.realpathSync.native(project.root_path);
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "プロジェクトが見つかりません" }, { status: 404 });
  }

  try {
    const root = resolveProjectRoot(project);
    const agents = listProjectAgents(root);
    return NextResponse.json({
      project: { id: project.id, name: project.name, rootPath: project.root_path },
      agents,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "エージェント一覧の取得に失敗しました" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "プロジェクトが見つかりません" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    content?: unknown;
  } | null;
  if (typeof body?.name !== "string" || typeof body?.content !== "string") {
    return NextResponse.json({ error: "nameとcontentを正しく指定してください" }, { status: 400 });
  }

  try {
    const root = resolveProjectRoot(project);
    const agent = writeProjectAgent(root, body.name.trim(), body.content);
    return NextResponse.json({ ok: true, agent });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "エージェントの保存に失敗しました" },
      { status: 400 },
    );
  }
}