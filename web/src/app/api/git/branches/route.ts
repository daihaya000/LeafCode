import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { runGit } from "@/lib/git";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const directory = req.nextUrl.searchParams.get("directory");
  if (!directory) {
    return NextResponse.json({ error: "directory is required" }, { status: 400 });
  }

  const check = assertAllowedDirectory(directory);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const head = await runGit(check.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branches = await runGit(check.path, ["branch", "--format=%(refname:short)"]);
  const upstream = await runGit(check.path, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  // Commits on current HEAD not present on its upstream — drives the Push
  // button badge. `0`/empty means up-to-date; a missing upstream yields -1 so
  // the UI can offer "publish" rather than "no commits to push".
  const aheadCount = await runGit(check.path, [
    "rev-list",
    "--count",
    "@{u}..HEAD",
  ]);

  if (head.code !== 0) {
    return NextResponse.json(
      { error: head.stderr.trim() || "not a git repo" },
      { status: 400 },
    );
  }

  const list = branches.stdout
    .split(/\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const current = head.stdout.trim();
  const upstreamBranch = upstream.code === 0 ? upstream.stdout.trim() : null;
  const ahead =
    aheadCount.code === 0 ? parseInt(aheadCount.stdout.trim(), 10) || 0 : -1;

  // `git remote` lists configured remotes. The Push button needs to know
  // whether a push target exists at all, and the publish flow falls back to
  // "origin" — report whether that specific remote is configured so the UI can
  // guide the user instead of emitting a blind `git push` that fails.
  const remotesResult = await runGit(check.path, ["remote"]);
  const remotes =
    remotesResult.code === 0
      ? remotesResult.stdout
          .split(/\r?\n/)
          .map((r) => r.trim())
          .filter(Boolean)
      : [];

  // Prefer upstream (tracking branch) if set, then main, master, else first non-current.
  // This ensures worktree branches from the user's expected base, not an arbitrary default.
  const preferred =
    (upstreamBranch && list.includes(upstreamBranch) ? upstreamBranch : null) ||
    list.find((b) => b === "main") ||
    list.find((b) => b === "master") ||
    list.find((b) => b !== current) ||
    null;

  // Prevent self-merge: if defaultTarget equals current, return null (R35#3).
  const defaultTarget = preferred && preferred !== current ? preferred : null;

  return NextResponse.json({
    current,
    branches: list,
    defaultTarget,
    upstream: upstreamBranch,
    ahead,
    remotes,
    hasRemote: remotes.length > 0,
  });
}
