import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listQuickAccess } from "@/lib/quickaccess";
import { assertAllowedDirectory } from "@/lib/allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SKIP = new Set([
  "System Volume Information",
  "$Recycle.Bin",
  "Recovery",
  "DumpStack.log.tmp",
]);

type Entry = { name: string; path: string; kind?: "dir" | "file" };
const QUICK_ACCESS_WAIT_MS = 750;

/** Do not let optional Explorer shortcuts block the usable folder listing. */
async function quickAccessWithoutBlocking(): Promise<Entry[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      listQuickAccess().catch(() => []),
      new Promise<Entry[]>((resolve) => {
        timer = setTimeout(() => resolve([]), QUICK_ACCESS_WAIT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function listDirs(dir: string, includeFiles = false): Entry[] {
  const dirs: Entry[] = [];
  const files: Entry[] = [];
  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "cannot read directory",
    );
  }
  for (const d of names) {
    if (SKIP.has(d.name)) continue;
    const full = path.join(dir, d.name);
    let isDir: boolean;
    try {
      // statSync resolves symlinks so a linked directory is still treated as one.
      const st = fs.statSync(full);
      isDir = st.isDirectory();
      if (!isDir && !st.isFile()) continue;
    } catch {
      continue;
    }
    if (isDir) dirs.push({ name: d.name, path: full, kind: "dir" });
    else if (includeFiles) files.push({ name: d.name, path: full, kind: "file" });
  }
  const cmp = (a: Entry, b: Entry) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  dirs.sort(cmp);
  files.sort(cmp);
  // Directories first, then files (only present when includeFiles is set).
  return [...dirs, ...files];
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

/**
 * List directories for in-browser project picker.
 * Default (no path): user home folder + Quick Access shortcuts.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("path");
  const home = os.homedir();
  // Opt-in: the in-task file tree needs files too; the project picker omits
  // this so it keeps listing directories only.
  const includeFiles = req.nextUrl.searchParams.get("files") === "1";

  let resolved: string;
  if (!raw || !raw.trim()) {
    resolved = path.resolve(home);
  } else {
    try {
      resolved = path.resolve(raw);
    } catch {
      return NextResponse.json({ error: "invalid path" }, { status: 400 });
    }
  }

  // When listing files for the in-task FileTree (files=1), restrict to
  // allowlisted project roots to prevent arbitrary directory traversal (R20).
  // The project picker (files=0) is intentionally unrestricted for home browsing.
  if (includeFiles) {
    const check = assertAllowedDirectory(resolved);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }
    resolved = check.path;
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: "path not found" }, { status: 404 });
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(resolved);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "stat failed" },
      { status: 400 },
    );
  }
  if (!st.isDirectory()) {
    return NextResponse.json({ error: "not a directory" }, { status: 400 });
  }

  const parentDir = path.dirname(resolved);
  const parent =
    samePath(resolved, home) || parentDir === resolved ? null : parentDir;
  const atHome = samePath(resolved, home);

  try {
    const entries = listDirs(resolved, includeFiles);
    const quickAccess = atHome ? await quickAccessWithoutBlocking() : [];
    return NextResponse.json({
      path: resolved,
      parent,
      quickAccess,
      entries,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "list failed" },
      { status: 400 },
    );
  }
}
