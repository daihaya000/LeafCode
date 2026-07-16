import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SAFE_BRANCH = /^[A-Za-z0-9._\/-]+$/;

export function assertSafeBranchName(name: string): void {
  if (!SAFE_BRANCH.test(name) || name.includes("..")) {
    throw new Error("invalid branch name");
  }
}

/** Run git with argv array only (no shell). */
export function runGit(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += String(c);
    });
    child.stderr.on("data", (c) => {
      stderr += String(c);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function addWorktree(input: {
  repoRoot: string;
  worktreePath: string;
  branch: string;
  baseBranch?: string;
}): Promise<void> {
  assertSafeBranchName(input.branch);
  if (input.baseBranch) assertSafeBranchName(input.baseBranch);

  const absWorktree = path.resolve(input.worktreePath);
  const args = ["worktree", "add", absWorktree, "-b", input.branch];
  if (input.baseBranch) {
    args.push(input.baseBranch);
  }

  const result = await runGit(input.repoRoot, args);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "git worktree add failed");
  }
}

function rmDirBestEffort(target: string): void {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}

/**
 * Remove a git worktree. On Windows / OneDrive, `git worktree remove` often
 * fails when metadata is already broken ("not a working tree") or files are
 * briefly locked — fall back to prune + filesystem delete.
 */
export async function removeWorktree(input: {
  repoRoot: string;
  worktreePath: string;
  force?: boolean;
}): Promise<void> {
  const absWorktree = path.resolve(input.worktreePath);
  const repoRoot = path.resolve(input.repoRoot);
  const force = input.force !== false;

  if (!fs.existsSync(absWorktree)) {
    await runGit(repoRoot, ["worktree", "prune", "--expire", "now"]);
    return;
  }

  const args = ["worktree", "remove", absWorktree];
  if (force) args.push("--force");
  const result = await runGit(repoRoot, args);
  if (result.code === 0) {
    await runGit(repoRoot, ["worktree", "prune", "--expire", "now"]);
    return;
  }

  const gitErr =
    result.stderr.trim() || result.stdout.trim() || "git worktree remove failed";

  // Metadata already gone / half-deleted — finish with prune + rimraf
  await runGit(repoRoot, ["worktree", "prune", "--expire", "now"]);

  try {
    rmDirBestEffort(absWorktree);
  } catch (err) {
    throw new Error(
      `${gitErr}; folder delete failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // Stale admin dir under .git/worktrees/<basename>
  const admin = path.join(repoRoot, ".git", "worktrees", path.basename(absWorktree));
  try {
    rmDirBestEffort(admin);
  } catch {
    /* best effort */
  }

  await runGit(repoRoot, ["worktree", "prune", "--expire", "now"]);

  if (fs.existsSync(absWorktree)) {
    throw new Error(gitErr);
  }
}

export async function gitStatus(cwd: string): Promise<string> {
  const result = await runGit(cwd, ["status", "--short"]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "git status failed");
  }
  return result.stdout;
}

/** Unstaged + staged unified diff (no pager). */
export async function gitDiff(cwd: string): Promise<string> {
  const staged = await runGit(cwd, ["diff", "--cached"]);
  const unstaged = await runGit(cwd, ["diff"]);
  if (staged.code !== 0 && unstaged.code !== 0) {
    throw new Error(
      staged.stderr.trim() || unstaged.stderr.trim() || "git diff failed",
    );
  }
  const parts = [staged.stdout.trim(), unstaged.stdout.trim()].filter(Boolean);
  return parts.join("\n\n") || "";
}

/** Parse `git worktree list --porcelain` into path entries. */
export async function listGitWorktrees(
  repoRoot: string,
): Promise<{ path: string; bare: boolean }[]> {
  const result = await runGit(repoRoot, ["worktree", "list", "--porcelain"]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "git worktree list failed");
  }
  const entries: { path: string; bare: boolean }[] = [];
  let current: { path?: string; bare: boolean } = { bare: false };
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current.path) entries.push({ path: current.path, bare: current.bare });
      current = { path: line.slice("worktree ".length).trim(), bare: false };
    } else if (line === "bare") {
      current.bare = true;
    } else if (line === "") {
      if (current.path) entries.push({ path: current.path, bare: current.bare });
      current = { bare: false };
    }
  }
  if (current.path) entries.push({ path: current.path, bare: current.bare });
  return entries;
}
