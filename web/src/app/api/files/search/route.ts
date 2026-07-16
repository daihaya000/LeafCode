import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".webui-worktrees",
  "coverage",
  ".turbo",
]);

function walk(
  root: string,
  dir: string,
  query: string,
  limit: number,
  out: string[],
): void {
  if (out.length >= limit) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= limit) return;
    const name = ent.name;
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
      walk(root, path.join(dir, name), query, limit, out);
      continue;
    }
    if (!ent.isFile()) continue;
    if (query && !name.toLowerCase().includes(query)) continue;
    out.push(path.relative(root, path.join(dir, name)).replace(/\\/g, "/"));
  }
}

/** Phase 1 simple Ctrl+P: on-demand directory scan (D3: 都度走査). */
export async function GET(req: NextRequest) {
  const directory = req.nextUrl.searchParams.get("directory");
  const q = (req.nextUrl.searchParams.get("q") ?? "").toLowerCase().trim();
  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50,
    200,
  );

  if (!directory) {
    return NextResponse.json({ error: "directory is required" }, { status: 400 });
  }

  const check = assertAllowedDirectory(directory);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const files: string[] = [];
  walk(check.path, check.path, q, limit, files);
  return NextResponse.json({ files, query: q, directory: check.path });
}
