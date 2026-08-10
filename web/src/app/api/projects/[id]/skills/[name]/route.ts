import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import {
  deleteProjectSkill,
  readProjectSkill,
  writeProjectSkill,
} from "@/lib/project-skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectRow = { id: string; name: string; root_path: string };

function getProject(id: string): ProjectRow | undefined {
  return getDb()
    .prepare("SELECT id, name, root_path FROM projects WHERE id = ?")
    .get(id) as ProjectRow | undefined;
}

function projectRoot(project: ProjectRow): string {
  return fs.realpathSync.native(project.root_path);
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; name: string }> },
) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;
  const { id, name } = await context.params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "プロジェクトが見つかりません" }, { status: 404 });
  }
  try {
    return NextResponse.json({ skill: readProjectSkill(projectRoot(project), name) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "スキルの読み込みに失敗しました" },
      { status: 400 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string; name: string }> },
) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;
  const { id, name } = await context.params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "プロジェクトが見つかりません" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { content?: unknown } | null;
  if (typeof body?.content !== "string") {
    return NextResponse.json({ error: "contentを正しく指定してください" }, { status: 400 });
  }
  try {
    const skill = writeProjectSkill(projectRoot(project), name, body.content);
    return NextResponse.json({ ok: true, skill });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "スキルの保存に失敗しました" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string; name: string }> },
) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;
  const { id, name } = await context.params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "プロジェクトが見つかりません" }, { status: 404 });
  }
  try {
    deleteProjectSkill(projectRoot(project), name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "スキルの削除に失敗しました" },
      { status: 400 },
    );
  }
}
