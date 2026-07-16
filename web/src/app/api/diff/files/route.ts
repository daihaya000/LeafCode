import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { parseUnifiedDiff, untrackedHunk } from "@/lib/diffparse";
import { runGit } from "@/lib/git";
import type { DiffFile, DiffFilesPayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UNTRACKED_BYTES = 200_000;

function isProbablyBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export async function GET(req: NextRequest) {
  const directory = req.nextUrl.searchParams.get("directory");
  if (!directory) {
    return NextResponse.json({ error: "directory is required" }, { status: 400 });
  }
  const check = assertAllowedDirectory(directory);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  const dir = check.path;

  const head = await runGit(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (head.code !== 0) {
    const payload: DiffFilesPayload = {
      git: false,
      branch: null,
      files: [],
      additions: 0,
      deletions: 0,
      error: "not a git repository",
    };
    return NextResponse.json(payload);
  }
  const branch = head.stdout.trim() || null;

  // Tracked changes (staged + unstaged vs HEAD); fresh repos fall back
  let diff = await runGit(dir, ["diff", "HEAD", "--no-color", "--no-ext-diff"]);
  if (diff.code !== 0) {
    const unstaged = await runGit(dir, ["diff", "--no-color", "--no-ext-diff"]);
    const staged = await runGit(dir, [
      "diff",
      "--cached",
      "--no-color",
      "--no-ext-diff",
    ]);
    diff = {
      code: 0,
      stdout: [staged.stdout, unstaged.stdout].filter(Boolean).join("\n"),
      stderr: "",
    };
  }

  const files: DiffFile[] = parseUnifiedDiff(diff.stdout);

  // Untracked files as synthetic all-added entries
  const status = await runGit(dir, ["status", "--porcelain"]);
  if (status.code === 0) {
    for (const line of status.stdout.split(/\r?\n/)) {
      if (!line.startsWith("??")) continue;
      let rel = line.slice(3).trim();
      if (rel.startsWith('"') && rel.endsWith('"')) rel = rel.slice(1, -1);
      if (rel.endsWith("/")) {
        files.push({
          path: rel,
          additions: 0,
          deletions: 0,
          binary: false,
          untracked: true,
          hunks: [],
        });
        continue;
      }
      const abs = path.join(dir, rel);
      const entry: DiffFile = {
        path: rel.replace(/\\/g, "/"),
        additions: 0,
        deletions: 0,
        binary: false,
        untracked: true,
        hunks: [],
      };
      try {
        const st = fs.statSync(abs);
        if (st.size <= MAX_UNTRACKED_BYTES) {
          const buf = fs.readFileSync(abs);
          if (isProbablyBinary(buf)) {
            entry.binary = true;
          } else {
            const hunk = untrackedHunk(buf.toString("utf8"));
            entry.hunks = [hunk];
            entry.additions = hunk.lines.filter((l) => l.t === "+").length;
          }
        }
      } catch {
        /* unreadable — list path only */
      }
      files.push(entry);
    }
  }

  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);
  const payload: DiffFilesPayload = { git: true, branch, files, additions, deletions };
  return NextResponse.json(payload);
}
