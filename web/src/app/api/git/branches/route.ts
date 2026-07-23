import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { runGit } from "@/lib/git";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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

  // Prefer upstream (tracking branch) if set, then main, master, else first non-current.
  // This ensures worktree branches from the user's expected base, not an arbitrary default.
  const preferred =
    (upstreamBranch && list.includes(upstreamBranch) ? upstreamBranch : null) ||
    list.find((b) => b === "main") ||
    list.find((b) => b === "master") ||
    list.find((b) => b !== current) ||
    null;

  return NextResponse.json({
    current,
    branches: list,
    defaultTarget: preferred,
    upstream: upstreamBranch,
  });
}
