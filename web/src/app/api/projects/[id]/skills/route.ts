import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { listProjectSkills, writeProjectSkill } from "@/lib/project-skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectRow = { id: string; name: string; root_path: string };

function getProject(id: string): ProjectRow | undefined {
  return getDb()
    .prepare("SELECT id, name, root_path FROM projects WHERE id = ?")
    .get(id) as ProjectRow | undefined;
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;
  const { id } = await context.params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "プロジェクトが見つかりません" }, { status: 404 });
  }
  try {
    const skills = listProjectSkills(fs.realpathSync.native(project.root_path));
    return NextResponse.json({
      project: { id: project.id, name: project.name, rootPath: project.root_path },
      skills,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "スキル一覧の取得に失敗しました" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    const skill = writeProjectSkill(
      fs.realpathSync.native(project.root_path),
      body.name.trim(),
      body.content,
    );
    return NextResponse.json({ ok: true, skill });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "スキルの保存に失敗しました" },
      { status: 400 },
    );
  }
}
