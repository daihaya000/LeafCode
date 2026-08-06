import { NextResponse } from "next/server";
import fs from "node:fs";
import { requireAuthorized } from "@/lib/api-guard";
import { openFileReveal, openFolder } from "@/lib/profiles/open";
import { profilePaths } from "@/lib/profiles/sync-engine";
import { agentsSyncPaths } from "@/lib/profiles/agents-sync-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fixed, server-resolved targets a settings row is allowed to reveal.
 *
 * The client only ever sends a `target` key from this list — never a raw
 * path — so an untrusted body can't make the server open an arbitrary file.
 */
const TARGET_RESOLVERS: Record<string, () => string> = {
  "sync-master": () => profilePaths().opencode,
  "sync-codex": () => profilePaths().codex,
  "sync-claude": () => profilePaths().claude,
  "agents-master": () => agentsSyncPaths().masterMd,
  "agents-claude": () => agentsSyncPaths().claudeMd,
  "agents-codex": () => agentsSyncPaths().codexMd,
  "skills-opencode": () => agentsSyncPaths().opencodeSkills,
  "skills-claude": () => agentsSyncPaths().claudeSkills,
  "skills-codex": () => agentsSyncPaths().codexSkills,
  "skills-agents": () => agentsSyncPaths().agentsSkills,
};

export async function POST(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  let body: { target?: string; action?: string };
  try {
    body = (await req.json().catch(() => ({}))) as {
      target?: string;
      action?: string;
    };
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const { target, action } = body;
  if (action !== "open-file" && action !== "open-folder") {
    return NextResponse.json(
      { error: "action は open-file または open-folder のみ有効です" },
      { status: 400 },
    );
  }
  if (typeof target !== "string" || !(target in TARGET_RESOLVERS)) {
    return NextResponse.json(
      { error: "target が不正です" },
      { status: 400 },
    );
  }

  const resolved = TARGET_RESOLVERS[target]();
  if (!fs.existsSync(resolved)) {
    return NextResponse.json(
      { error: `${resolved} が見つかりません。` },
      { status: 409 },
    );
  }

  const err =
    action === "open-file" ? openFileReveal(resolved) : openFolder(resolved);
  if (err) {
    return NextResponse.json({ error: err }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
