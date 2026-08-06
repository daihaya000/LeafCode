import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { requireAuthorized } from "@/lib/api-guard";

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

// Hard ceilings so a synchronous scan of a huge repo cannot block the BFF
// event loop indefinitely. Once `MAX_ENTRIES` directory entries have been
// inspected the scan stops even if `limit` matches were not yet found.
const MAX_ENTRIES = 20_000;
const MAX_DEPTH = 12;

function walk(
  root: string,
  dir: string,
  query: string,
  limit: number,
  out: string[],
  budget: { visited: number },
  depth: number,
): void {
  if (out.length >= limit) return;
  if (budget.visited >= MAX_ENTRIES) return;
  if (depth > MAX_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= limit) return;
    if (budget.visited >= MAX_ENTRIES) return;
    budget.visited++;
    const name = ent.name;
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
      walk(root, path.join(dir, name), query, limit, out, budget, depth + 1);
      continue;
    }
    if (!ent.isFile()) continue;
    if (query && !name.toLowerCase().includes(query)) continue;
    out.push(path.relative(root, path.join(dir, name)).replace(/\\/g, "/"));
  }
}

/** Phase 1 simple Ctrl+P: on-demand directory scan (D3: 都度走査). */
export async function GET(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

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
  walk(check.path, check.path, q, limit, files, { visited: 0 }, 0);
  return NextResponse.json({ files, query: q, directory: check.path });
}
