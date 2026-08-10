import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { invalidateDirStat } from "@/lib/dirstat";
import { runGit } from "@/lib/git";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Push the current branch to its upstream (or a named remote branch).
 *
 * Body:
 *   directory: string  (required) — repo path under an allowed root
 *   remote?:   string  — remote name (default: origin)
 *   branch?:   string  — explicit ref to push (default: HEAD). When omitted,
 *                        `git push` uses the tracked upstream.
 *   setUpstream?: boolean — pass `-u` so a branch with no tracking ref is
 *                            wired to the remote on first push.
 *   force?:    boolean — `--force-with-lease` (safer than --force: refuses
 *                        when the remote moved unexpectedly). Off by default.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as {
    directory?: string;
    remote?: string;
    branch?: string;
    setUpstream?: boolean;
    force?: boolean;
  } | null;

  if (!body?.directory) {
    return NextResponse.json(
      { error: "directory is required" },
      { status: 400 },
    );
  }

  const check = assertAllowedDirectory(body.directory);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  // Remote name: accept only simple identifiers (origin, upstream, …). The
  // value is interpolated into argv, not a shell, so the main risk is a
  // pathspec-like value (`--all`); the leading-char ban blocks that.
  const REMOTE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const remote = body.remote?.trim() || "origin";
  if (!REMOTE_RE.test(remote)) {
    return NextResponse.json({ error: "invalid remote" }, { status: 400 });
  }

  const args = ["push"];
  if (body.force) args.push("--force-with-lease");
  if (body.setUpstream) args.push("-u");

  // Branch: allow only safe branch-name characters so a crafted ref like
  // `--all` or `:refs/heads/main` (a delete) cannot slip through. The
  // `src:dst` push refspec is intentionally NOT supported here — callers
  // push HEAD; PR/merge targets are handled by their own routes.
  if (body.branch?.trim()) {
    const branch = body.branch.trim();
    if (
      branch.length > 200 ||
      !/^[\p{L}\p{N}._/+-]+$/u.test(branch) ||
      branch.startsWith("-") ||
      branch.startsWith("/") ||
      branch.endsWith("/") ||
      branch.includes("..") ||
      branch.includes("//") ||
      branch.includes(":")
    ) {
      return NextResponse.json({ error: "invalid branch" }, { status: 400 });
    }
    args.push(remote, branch);
  } else {
    // No explicit ref: push HEAD to its tracked upstream, or use the safer
    // `push origin HEAD` when there is no upstream yet so the caller gets a
    // clear error rather than pushing all matching branches.
    args.push(remote, "HEAD");
  }

  const result = await runGit(check.path, args);
  if (result.code !== 0) {
    return NextResponse.json(
      {
        error: result.stderr.trim() || result.stdout.trim() || "git push failed",
      },
      { status: 500 },
    );
  }

  // Pushing HEAD doesn't change the working tree, but the remote-tracking ref
  // state moves; refresh the dir stat so any "ahead" badge in the UI updates.
  invalidateDirStat(check.path);

  // Surface what was pushed so the UI can show a concise confirmation. `git
  // push` prints a range of human text; the most useful line is usually the
  // `* branch-name -> remote/branch-name` summary. Fall back to trimmed
  // stdout if parsing doesn't find it.
  const summary =
    /^\*\s+(.+)$/m.exec(result.stdout)?.[1]?.trim() ||
    result.stdout.trim() ||
    "pushed";

  return NextResponse.json({ ok: true, summary });
}