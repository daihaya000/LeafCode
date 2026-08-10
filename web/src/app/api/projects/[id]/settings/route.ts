import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import {
  isProjectSettingFileKey,
  PROJECT_SETTING_FILES,
  type ProjectSettingFileKey,
} from "@/lib/project-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

type ProjectRow = { id: string; name: string; root_path: string };

function getProject(id: string): ProjectRow | undefined {
  return getDb()
    .prepare("SELECT id, name, root_path FROM projects WHERE id = ?")
    .get(id) as ProjectRow | undefined;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveProjectRoot(project: ProjectRow): string {
  return fs.realpathSync.native(project.root_path);
}

function settingPath(root: string, key: ProjectSettingFileKey): string {
  return path.join(root, ...key.split("/"));
}

function readSetting(root: string, key: ProjectSettingFileKey) {
  const target = settingPath(root, key);
  if (!fs.existsSync(target)) return { exists: false, content: "" };

  const realTarget = fs.realpathSync.native(target);
  if (!isWithinRoot(root, realTarget) || !fs.statSync(realTarget).isFile()) {
    throw new Error(`${key}を安全に読み込めません`);
  }
  const size = fs.statSync(realTarget).size;
  if (size > MAX_FILE_BYTES) throw new Error(`${key}は2MBを超えているため編集できません`);
  return { exists: true, content: fs.readFileSync(realTarget, "utf8") };
}

function writeSetting(root: string, key: ProjectSettingFileKey, content: string) {
  const target = settingPath(root, key);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const realParent = fs.realpathSync.native(parent);
  if (!isWithinRoot(root, realParent)) {
    throw new Error(`${key}の保存先がプロジェクト外です`);
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new Error(`${key}はシンボリックリンクのため編集できません`);
  }
  fs.writeFileSync(target, content, "utf8");
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
    const files = PROJECT_SETTING_FILES.map((file) => ({
      ...file,
      ...readSetting(root, file.key),
    }));
    return NextResponse.json({
      project: { id: project.id, name: project.name, rootPath: project.root_path },
      files,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "プロジェクト設定の読み込みに失敗しました" },
      { status: 500 },
    );
  }
}

export async function PATCH(
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
    file?: unknown;
    content?: unknown;
  } | null;
  if (!isProjectSettingFileKey(body?.file) || typeof body?.content !== "string") {
    return NextResponse.json({ error: "fileとcontentを正しく指定してください" }, { status: 400 });
  }
  if (Buffer.byteLength(body.content, "utf8") > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "設定ファイルは2MB以内で指定してください" }, { status: 413 });
  }

  try {
    const root = resolveProjectRoot(project);
    writeSetting(root, body.file, body.content);
    return NextResponse.json({ ok: true, file: body.file, exists: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "プロジェクト設定の保存に失敗しました" },
      { status: 500 },
    );
  }
}
