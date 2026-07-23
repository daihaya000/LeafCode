import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

/**
 * Reject option injection / path traversal / shell-dangerous chars while
 * allowing Unicode branch names (e.g. 機能/ログイン).
 */
const SAFE_BRANCH = /^[\p{L}\p{N}._/+-]+$/u;

export function assertSafeBranchName(name: string): void {
  if (
    !name ||
    name.length > 200 ||
    !SAFE_BRANCH.test(name) ||
    name.startsWith("-") ||
    name.startsWith("/") ||
    name.endsWith("/") ||
    name.includes("..") ||
    name.includes("//")
  ) {
    throw new Error("invalid branch name");
  }
}

/** Run git with argv array only (no shell). */
export function runGit(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // `core.quotepath=false` keeps non-ASCII paths (e.g. Japanese filenames)
    // literal instead of octal-escaped, so status/diff/name-status output can be
    // matched against the filesystem. The env vars stop git from blocking on an
    // interactive credential/editor prompt, which would hang the HTTP request.
    const child = spawn("git", ["-c", "core.quotepath=false", ...args], {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_EDITOR: "true",
      },
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

/** Clear read-only attributes so Windows can unlink git objects/packs. */
function clearReadonlyRecursive(target: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return;
  }
  try {
    fs.chmodSync(target, 0o700);
  } catch {
    /* best effort */
  }
  if (stat.isDirectory()) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(target);
    } catch {
      return;
    }
    for (const entry of entries) {
      clearReadonlyRecursive(path.join(target, entry));
    }
  }
}

/** True when `child` is strictly nested inside `parent` (root coincidence rejected). */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  // Reject root coincidence so removeWorktree cannot delete the repo root or
  // the worktree base itself when a crafted sessions.json points at the root.
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function isSamePath(left: string, right: string): boolean {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

function rmDirBestEffort(target: string): void {
  if (!fs.existsSync(target)) return;
  try {
    fs.rmSync(target, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 250,
    });
  } catch (err) {
    // Windows: read-only git objects/packs cause EPERM. Clear attrs and retry.
    if (fs.existsSync(target)) {
      clearReadonlyRecursive(target);
      fs.rmSync(target, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 250,
      });
    } else {
      throw err;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Remove a git worktree. On Windows / OneDrive, `git worktree remove` often
 * fails when metadata is already broken ("not a working tree") or files are
 * briefly locked — fall back to prune + filesystem delete with retries.
 */
export async function removeWorktree(input: {
  repoRoot: string;
  worktreePath: string;
  force?: boolean;
}): Promise<void> {
  const absWorktree = path.resolve(input.worktreePath);
  const repoRoot = path.resolve(input.repoRoot);
  const force = input.force !== false;

  // Defense-in-depth: worktrees we provision live either under the repo root
  // (legacy <repoRoot>/.webui-worktrees/…) or under the machine-local data dir
  // (<dataDir>/worktrees/…). Refuse to touch anything outside both so a
  // tampered manifest / DB row can't drive the filesystem-delete fallback into
  // an arbitrary directory.
  const worktreeBase = path.resolve(dataDir(), "worktrees");
  // Check protected roots before the allow-list OR. A repo root nested under
  // worktreeBase would otherwise pass `isInside(worktreeBase, absWorktree)`.
  if (isSamePath(absWorktree, repoRoot) || isSamePath(absWorktree, worktreeBase)) {
    throw new Error(`refusing to remove protected root: ${absWorktree}`);
  }
  if (!isInside(repoRoot, absWorktree) && !isInside(worktreeBase, absWorktree)) {
    throw new Error(
      `refusing to remove worktree outside repo root and data dir: ${absWorktree}`,
    );
  }

  if (!fs.existsSync(absWorktree)) {
    await runGit(repoRoot, ["worktree", "prune", "--expire", "now"]);
    // Stale admin dir under .git/worktrees/<basename>
    const adminGone = path.join(
      repoRoot,
      ".git",
      "worktrees",
      path.basename(absWorktree),
    );
    try {
      rmDirBestEffort(adminGone);
    } catch {
      /* best effort */
    }
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

  let lastRmErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      rmDirBestEffort(absWorktree);
      lastRmErr = undefined;
      break;
    } catch (err) {
      lastRmErr = err;
      await sleep(300 * (attempt + 1));
    }
  }
  if (lastRmErr && fs.existsSync(absWorktree)) {
    throw new Error(
      `${gitErr}; folder delete failed: ${
        lastRmErr instanceof Error ? lastRmErr.message : String(lastRmErr)
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

const SAFE_HASH = /^[0-9a-f]{7,64}$/i;

export function assertSafeCommitHash(hash: string): void {
  if (!SAFE_HASH.test(hash)) throw new Error("invalid commit hash");
}

const LOG_SEP = "\x1f";
const LOG_REC = "\x1e";

/** Commits for graph panel (newest first). */
export async function gitLogGraph(
  cwd: string,
  limit = 80,
  skip = 0,
): Promise<{ commits: import("./types").GraphCommit[]; hasMore: boolean }> {
  const n = Math.min(Math.max(limit, 1), 200);
  const s = Math.max(skip, 0);
  const fmt = ["%H", "%P", "%s", "%an", "%cI"].join(LOG_SEP);
  const result = await runGit(cwd, [
    "log",
    "--all",
    "--date-order",
    `-n${n + 1}`,
    `--skip=${s}`,
    `--pretty=format:${fmt}${LOG_REC}`,
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "git log failed");
  }
  const raw = result.stdout.split(LOG_REC).map((r) => r.trim()).filter(Boolean);
  const hasMore = raw.length > n;
  const commits = raw.slice(0, n).map((rec) => {
    const [hash, parents, subject, author, date] = rec.split(LOG_SEP);
    return {
      hash: hash ?? "",
      shortHash: (hash ?? "").slice(0, 7),
      parents: (parents ?? "").trim() ? (parents ?? "").trim().split(/\s+/) : [],
      subject: subject ?? "",
      author: author ?? "",
      date: date ?? "",
    };
  });
  return { commits, hasMore };
}

/** Local branch tips (+ current HEAD name). */
export async function gitBranchRefs(
  cwd: string,
): Promise<{ refs: import("./types").GraphRef[]; currentBranch: string | null }> {
  const head = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const currentBranch = head.code === 0 ? head.stdout.trim() : null;

  const listed = await runGit(cwd, [
    "for-each-ref",
    "--format=%(objectname)%00%(refname:short)",
    "refs/heads",
  ]);
  if (listed.code !== 0) {
    return { refs: [], currentBranch };
  }
  const refs: import("./types").GraphRef[] = [];
  for (const line of listed.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [hash, name] = line.split("\0");
    if (!hash || !name) continue;
    refs.push({
      name,
      hash,
      current: name === currentBranch,
    });
  }
  return { refs, currentBranch };
}

/** Files changed in a commit (name-status). */
export async function gitCommitFiles(
  cwd: string,
  hash: string,
): Promise<import("./types").GraphFileChange[]> {
  assertSafeCommitHash(hash);
  const result = await runGit(cwd, [
    "show",
    "--name-status",
    "--format=",
    "--no-renames",
    hash,
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "git show failed");
  }
  const files: import("./types").GraphFileChange[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^([MADCRTUX])\t(.+)$/.exec(line);
    if (!m) continue;
    files.push({
      status: m[1] as import("./types").GraphFileChange["status"],
      path: m[2].replace(/\\/g, "/"),
    });
  }
  return files;
}

/** Unified diff for one file in a commit. */
export async function gitCommitFileDiff(
  cwd: string,
  hash: string,
  filePath: string,
): Promise<string> {
  assertSafeCommitHash(hash);
  const normalized = filePath.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    normalized.includes("..")
  ) {
    throw new Error("invalid file path");
  }
  const result = await runGit(cwd, [
    "show",
    "--format=",
    "--no-color",
    "--no-ext-diff",
    hash,
    "--",
    normalized,
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "git show file failed");
  }
  return result.stdout;
}
