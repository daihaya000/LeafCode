import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { requireAuthorized } from "@/lib/api-guard";
import { openFileReveal, openFolder } from "@/lib/profiles/open";
import { ensureRegistry, resolveActiveId } from "@/lib/profiles/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAuthorized(req);
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
    const err = openFolder(profile.path);
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
    const err = openFolder(profile.path);
    if (err) {
      return NextResponse.json({ error: err }, { status: 500 });
    }
    return NextResponse.json({ ok: true, note: "設定ファイルが見つからないためフォルダを開きました。" });
  }

  const err = openFileReveal(target);
  if (err) {
    return NextResponse.json({ error: err }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
