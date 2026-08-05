import { NextResponse } from "next/server";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { rejectUnlessLocal } from "@/lib/local-request";
import { ensureRegistry, resolveActiveId } from "@/lib/profiles/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = rejectUnlessLocal(req);
  if (denied) return denied;

  const { id } = await params;
  let body: { action?: string };
  try {
    body = (await req.json().catch(() => ({}))) as { action?: string };
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const action = body.action;
  if (action !== "open-file" && action !== "open-folder") {
    return NextResponse.json(
      { error: "action は open-file または open-folder のみ有効です" },
      { status: 400 },
    );
  }

  const { state, link } = ensureRegistry();
  const activeId = resolveActiveId(state, link);
  if (id !== activeId) {
    return NextResponse.json(
      { error: "アクティブなプロファイルのみ開くことができます。" },
      { status: 409 },
    );
  }

  const profile = state.profiles.find((p) => p.id === id);
  if (!profile) {
    return NextResponse.json(
      { error: "プロファイルが見つかりません。" },
      { status: 404 },
    );
  }

  if (!fs.existsSync(profile.path)) {
    return NextResponse.json(
      { error: "プロファイルディレクトリが存在しません。" },
      { status: 409 },
    );
  }

  if (action === "open-folder") {
    const err = openPath(profile.path);
    if (err) {
      return NextResponse.json({ error: err }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // open-file: search for a known config file to reveal.
  const candidates = [
    "opencode.jsonc",
    "opencode.json",
    "config.json",
    "config.jsonc",
  ];
  let target: string | null = null;
  for (const name of candidates) {
    const full = path.join(profile.path, name);
    if (fs.existsSync(full)) {
      target = full;
      break;
    }
  }

  if (!target) {
    // Fallback: reveal the folder itself.
    const err = openPath(profile.path);
    if (err) {
      return NextResponse.json({ error: err }, { status: 500 });
    }
    return NextResponse.json({ ok: true, note: "設定ファイルが見つからないためフォルダを開きました。" });
  }

  const err = openFile(target);
  if (err) {
    return NextResponse.json({ error: err }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

function openPath(target: string): string | null {
  if (process.platform === "win32") {
    // explorer /select, when given a directory, selects it in the parent; using
    // just the directory path opens it. /root gives the intended behaviour.
    const result = spawnSync("explorer.exe", [target], {
      windowsHide: true,
      encoding: "utf8",
    });
    if (result.error) return result.error.message;
    return null;
  }
  if (process.platform === "darwin") {
    const result = spawnSync("open", [target], { encoding: "utf8" });
    if (result.error) return result.error.message;
    return null;
  }
  const result = spawnSync("xdg-open", [target], { encoding: "utf8" });
  if (result.error) return result.error.message;
  return null;
}

function openFile(target: string): string | null {
  if (process.platform === "win32") {
    // /select opens the parent folder with the file highlighted.
    const result = spawnSync("explorer.exe", ["/select,", target], {
      windowsHide: true,
      encoding: "utf8",
    });
    if (result.error) return result.error.message;
    return null;
  }
  if (process.platform === "darwin") {
    const result = spawnSync("open", ["-R", target], { encoding: "utf8" });
    if (result.error) return result.error.message;
    return null;
  }
  // Linux: xdg-open generally opens the default editor for files.
  const result = spawnSync("xdg-open", [target], { encoding: "utf8" });
  if (result.error) return result.error.message;
  return null;
}
