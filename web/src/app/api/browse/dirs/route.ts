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

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

/**
 * List directories for in-browser project picker.
 * Default (no path): user home folder.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("path");
  const home = os.homedir();

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

  // Stop "上へ" at the user home folder
  const parentDir = path.dirname(resolved);
  const parent =
    samePath(resolved, home) || parentDir === resolved ? null : parentDir;

  try {
    const entries = listDirs(resolved);
    return NextResponse.json({
      path: resolved,
      parent,
      entries,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "list failed" },
      { status: 400 },
    );
  }
}
