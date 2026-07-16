import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SKIP = new Set([
  "System Volume Information",
  "$Recycle.Bin",
  "Recovery",
  "DumpStack.log.tmp",
]);

type Entry = { name: string; path: string };

function listWindowsDrives(): Entry[] {
  const drives: Entry[] = [];
  for (let i = 65; i <= 90; i += 1) {
    const letter = String.fromCharCode(i);
    const root = `${letter}:\\`;
    try {
      if (fs.existsSync(root)) {
        drives.push({ name: `${letter}:`, path: root });
      }
    } catch {
      /* skip */
    }
  }
  return drives;
}

function listDirs(dir: string): Entry[] {
  const entries: Entry[] = [];
  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "cannot read directory",
    );
  }
  for (const d of names) {
    if (!d.isDirectory() && !d.isSymbolicLink()) continue;
    if (SKIP.has(d.name)) continue;
    const full = path.join(dir, d.name);
    try {
      // Resolve symlink targets that are directories; skip broken links
      const st = fs.statSync(full);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    entries.push({ name: d.name, path: full });
  }
  entries.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  return entries;
}

/**
 * List filesystem directories for in-browser project picker (phone-friendly).
 * GET /api/browse/dirs          → drives + home
 * GET /api/browse/dirs?path=…   → children of path
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("path");

  if (!raw || !raw.trim()) {
    const home = os.homedir();
    const roots: Entry[] = [];
    if (process.platform === "win32") {
      roots.push(...listWindowsDrives());
    } else {
      roots.push({ name: "/", path: "/" });
    }
    if (fs.existsSync(home)) {
      roots.unshift({ name: `ホーム (${path.basename(home)})`, path: home });
    }
    return NextResponse.json({
      path: null,
      parent: null,
      entries: roots,
    });
  }

  let resolved: string;
  try {
    resolved = path.resolve(raw);
  } catch {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
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
    parentDir && parentDir !== resolved
      ? parentDir
      : process.platform === "win32" && /^[A-Za-z]:\\?$/.test(resolved)
        ? null
        : parentDir !== resolved
          ? parentDir
          : null;

  try {
    const entries = listDirs(resolved);
    return NextResponse.json({
      path: resolved,
      parent:
        process.platform === "win32" && /^[A-Za-z]:\\$/.test(resolved)
          ? null
          : parent === resolved
            ? null
            : parent,
      entries,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "list failed" },
      { status: 400 },
    );
  }
}
