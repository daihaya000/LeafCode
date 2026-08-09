import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function hasGitDir(directory: string): Promise<boolean> {
  try {
    const git = await stat(path.join(directory, ".git"));
    return git.isDirectory() || git.isFile();
  } catch {
    return false;
  }
}

/** List the opened folder itself and its immediate Git repositories. */
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

  try {
    const entries = await readdir(check.path, { withFileTypes: true });
    const children = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const childPath = path.join(check.path, entry.name);
          return (await hasGitDir(childPath))
            ? { path: childPath, name: entry.name }
            : null;
        }),
    );
    const repositories = children
      .filter(
        (repository): repository is { path: string; name: string } => repository !== null,
      )
      .sort((left, right) => left.name.localeCompare(right.name));
    if (await hasGitDir(check.path)) {
      repositories.unshift({ path: check.path, name: path.basename(check.path) || check.path });
    }
    return NextResponse.json({ repositories });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not list repositories" },
      { status: 400 },
    );
  }
}
