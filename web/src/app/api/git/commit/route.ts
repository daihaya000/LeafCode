import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { runGit } from "@/lib/git";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_MSG = /^[\s\S]{1,2000}$/;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    directory?: string;
    message?: string;
    paths?: string[];
    all?: boolean;
  } | null;

  if (!body?.directory || !body.message?.trim()) {
    return NextResponse.json(
      { error: "directory and message are required" },
      { status: 400 },
    );
  }

  if (!SAFE_MSG.test(body.message)) {
    return NextResponse.json({ error: "invalid commit message" }, { status: 400 });
  }

  const check = assertAllowedDirectory(body.directory);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  // Stage — require an explicit all:true or a non-empty paths list. Treating
  // missing/`all:false` with no paths as "stage everything" made accidental
  // full-tree commits too easy for any API client.
  if (body.all === true) {
    // Never let "commit everything" sweep in our own metadata (session manifest
    // and worktree dirs), which appear as untracked in the user's repo.
    const add = await runGit(check.path, [
      "add",
      "-A",
      "--",
      ".",
      ":(exclude).opencode-webui",
      ":(exclude).opencode-webui/**",
      ":(exclude).webui-worktrees",
      ":(exclude).webui-worktrees/**",
    ]);
    if (add.code !== 0) {
      return NextResponse.json(
        { error: add.stderr.trim() || "git add failed" },
        { status: 500 },
      );
    }
  } else if (body.paths?.length) {
    for (const p of body.paths) {
      if (p.includes("..") || p.startsWith("-")) {
        return NextResponse.json({ error: `unsafe path: ${p}` }, { status: 400 });
      }
    }
    const add = await runGit(check.path, ["add", "--", ...body.paths]);
    if (add.code !== 0) {
      return NextResponse.json(
        { error: add.stderr.trim() || "git add failed" },
        { status: 500 },
      );
    }
  } else {
    return NextResponse.json(
      { error: "paths or all:true is required" },
      { status: 400 },
    );
  }

  // For a partial (paths) selection, scope the commit to those paths too.
  // Without a pathspec, `git commit` would also include anything else already
  // staged in the index (e.g. from a prior/external `git add`), committing
  // files the user explicitly deselected.
  const commitArgs = ["commit", "-m", body.message.trim()];
  if (!body.all && body.paths?.length) {
    commitArgs.push("--", ...body.paths);
  }
  const commit = await runGit(check.path, commitArgs);
  if (commit.code !== 0) {
    return NextResponse.json(
      {
        error: commit.stderr.trim() || commit.stdout.trim() || "git commit failed",
        stdout: commit.stdout,
      },
      { status: 500 },
    );
  }

  const log = await runGit(check.path, ["log", "-1", "--oneline"]);
  return NextResponse.json({
    ok: true,
    summary: log.stdout.trim() || commit.stdout.trim(),
  });
}
