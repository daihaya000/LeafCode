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

  // Prefer main, then master, else first non-current
  const current = head.stdout.trim();
  const preferred =
    list.find((b) => b === "main") ||
    list.find((b) => b === "master") ||
    list.find((b) => b !== current) ||
    null;

  return NextResponse.json({
    current,
    branches: list,
    defaultTarget: preferred,
    upstream: upstream.code === 0 ? upstream.stdout.trim() : null,
  });
}
