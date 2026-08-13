import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { invalidateDirStat } from "@/lib/dirstat";
import { runGit } from "@/lib/git";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status });
}

/**
 * Initialize a git repository in the project directory.
 *
 * `git init` is idempotent — re-running on an existing repository succeeds
 * ("Reinitialized existing Git repository"), so no pre-check is needed. The
 * default branch name is left to git's own configuration rather than forced
 * with `-b main`.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as {
    directory?: string;
  } | null;

  if (!body?.directory) {
    return errorResponse("directory is required", 400);
  }
  const check = assertAllowedDirectory(body.directory);
  if (!check.ok) {
    return errorResponse(check.error, check.status);
  }

  const init = await runGit(check.path, ["init"]);
  if (init.code !== 0) {
    return errorResponse(init.stderr.trim() || "git init failed", 500);
  }

  invalidateDirStat(check.path);
  return NextResponse.json({ ok: true, directory: check.path });
}
