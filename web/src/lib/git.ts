import { spawn } from "node:child_process";
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

export async function removeWorktree(input: {
  repoRoot: string;
  worktreePath: string;
  force?: boolean;
}): Promise<void> {
  const absWorktree = path.resolve(input.worktreePath);
  const args = ["worktree", "remove", absWorktree];
  if (input.force) args.push("--force");
  const result = await runGit(input.repoRoot, args);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "git worktree remove failed");
  }
}
