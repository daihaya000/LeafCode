import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { invalidateDirStat } from "@/lib/dirstat";
import { runGit } from "@/lib/git";
import { commitPathError } from "./path-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_MSG = /^[\s\S]{1,2000}$/;
const SAFE_AGENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    directory?: string;
    message?: string;
    paths?: string[];
    all?: boolean;
    agent?: string;
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
      const err = commitPathError(p);
      if (err) {
        return NextResponse.json({ error: err }, { status: 400 });
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

  // Enforce the execution agent as the commit author so every WebUI-driven
  // commit is attributable even when the workspace shares the user's directory
  // (current_folder) or overrides may exist in the repo's Git config.
  const agentName = body.agent?.trim() || "build";
  const gitEnv: Record<string, string> | undefined = SAFE_AGENT.test(agentName)
    ? {
        GIT_AUTHOR_NAME: agentName,
        GIT_AUTHOR_EMAIL: `${agentName}@opencode.local`,
        GIT_COMMITTER_NAME: agentName,
        GIT_COMMITTER_EMAIL: `${agentName}@opencode.local`,
      }
    : undefined;

  const commit = await runGit(check.path, commitArgs, undefined, gitEnv);
  if (commit.code !== 0) {
    return NextResponse.json(
      {
        error: commit.stderr.trim() || commit.stdout.trim() || "git commit failed",
        stdout: commit.stdout,
      },
      { status: 500 },
    );
  }

  // The working tree changed; drop the cached dir stat so task cards refresh
  // immediately instead of showing up-to-15s-stale diff counts.
  invalidateDirStat(check.path);

  const log = await runGit(check.path, ["log", "-1", "--oneline"]);
  return NextResponse.json({
    ok: true,
    summary: log.stdout.trim() || commit.stdout.trim(),
  });
}
