import { execFile } from "node:child_process";
import { cp, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { GITHUB_REPO_URL, installationRoot, isGitInstall } from "./install-root";
import {
  readGitRestoreProgress,
  writeGitRestoreProgress,
  writeUpdateRecord,
} from "./install-state";

const execFileAsync = promisify(execFile);

/** Skip re-attempting for this long after a failed attempt (survives process restarts). */
const COOLDOWN_MS = 5 * 60_000;
const CLONE_TIMEOUT_MS = 300_000;
const RESET_TIMEOUT_MS = 180_000;
/** Above this many failed attempts, stop logging at warn level (still retries silently). */
const MAX_WARN_ATTEMPTS = 5;
const MOVE_RETRY_DELAYS_MS = [500, 1000, 2000];

// Guards against overlapping runs within a single process (instrumentation's
// register() firing more than once, or a caller invoking this concurrently).
let inFlight = false;

function log(message: string): void {
  console.log(`[git-restore] ${message}`);
}

function warn(message: string): void {
  console.warn(`[git-restore] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function gitExec(args: string[], cwd: string, timeout: number) {
  return execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

/**
 * Moves just the `.git` directory from a scratch clone into the install root.
 * `rename` is preferred (atomic); falls back to copy+remove across devices,
 * and retries transient Windows lock errors (OneDrive sync / AV scanners are
 * known to briefly hold handles on files in this repo, see host/web-runtime.js).
 */
async function moveGitDir(src: string, dest: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(src, dest);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EXDEV") {
        await cp(src, dest, { recursive: true });
        await rm(src, { recursive: true, force: true });
        return;
      }
      if (code !== "EBUSY" && code !== "EPERM") throw err;
      if (attempt >= MOVE_RETRY_DELAYS_MS.length) throw err;
      await sleep(MOVE_RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function cloneToTemp(): Promise<{ tmpDir: string; defaultBranch: string }> {
  const tmpDir = await mkdtemp(join(tmpdir(), "opencode-webui-git-restore-"));
  try {
    await execFileAsync(
      "git",
      ["clone", "--origin", "origin", "--no-checkout", GITHUB_REPO_URL, tmpDir],
      {
        encoding: "utf8",
        timeout: CLONE_TIMEOUT_MS,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
    );
    const gitDir = join(tmpDir, ".git");
    await execFileAsync("git", ["--git-dir", gitDir, "rev-parse", "--verify", "HEAD"], {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
    const { stdout } = await execFileAsync(
      "git",
      ["--git-dir", gitDir, "symbolic-ref", "--short", "HEAD"],
      { encoding: "utf8", timeout: 10_000, windowsHide: true },
    );
    return { tmpDir, defaultBranch: stdout.trim() };
  } catch (err) {
    // The clone itself (or a post-clone check) failed — the caller never
    // gets tmpDir to move/clean up, so this would otherwise leak a scratch
    // clone into the OS temp dir on every failed attempt.
    await rm(tmpDir, { recursive: true, force: true });
    throw err;
  }
}

async function detectDefaultBranchFromExistingGit(root: string): Promise<string> {
  const { stdout } = await gitExec(["symbolic-ref", "refs/remotes/origin/HEAD"], root, 10_000);
  return stdout.trim().replace(/^refs\/remotes\/origin\//, "");
}

async function attempt(root: string): Promise<void> {
  const gitExists = isGitInstall(root);
  const progress = readGitRestoreProgress(root);

  if (gitExists && !progress) {
    // A real git checkout (dev clone, or already restored some other way).
    // Never touch it — just record "done" so future startups short-circuit
    // on the cheap `gitExists && phase==="done"` check below.
    writeGitRestoreProgress(root, { phase: "done", doneAt: new Date().toISOString() });
    return;
  }
  if (gitExists && progress?.phase === "done") return;

  if (progress?.lastAttemptAt) {
    const elapsed = Date.now() - new Date(progress.lastAttemptAt).getTime();
    if (elapsed < COOLDOWN_MS) {
      log(`前回の試行から${Math.round(elapsed / 1000)}秒しか経過していないためスキップします。`);
      return;
    }
  }

  const attemptStartedAt = new Date().toISOString();
  const attemptCount = (progress?.attemptCount ?? 0) + 1;
  const logFn = attemptCount > MAX_WARN_ATTEMPTS ? log : warn;

  try {
    let defaultBranch: string;
    if (!gitExists) {
      log("zip配布インストールを検出しました。GitHubからgit履歴を復元します。");
      const cloned = await cloneToTemp();
      defaultBranch = cloned.defaultBranch;
      writeGitRestoreProgress(root, {
        phase: "cloned",
        defaultBranch,
        clonedAt: attemptStartedAt,
        lastAttemptAt: attemptStartedAt,
        attemptCount,
      });
      try {
        await moveGitDir(join(cloned.tmpDir, ".git"), join(root, ".git"));
      } finally {
        // Always clean up the scratch clone, whether or not the move
        // succeeded — a failed move must not leave it behind either.
        await rm(cloned.tmpDir, { recursive: true, force: true });
      }
    } else {
      defaultBranch = progress?.defaultBranch ?? (await detectDefaultBranchFromExistingGit(root));
      writeGitRestoreProgress(root, {
        phase: "cloned",
        defaultBranch,
        lastAttemptAt: attemptStartedAt,
        attemptCount,
      });
    }

    await gitExec(["reset", "--hard", `origin/${defaultBranch}`], root, RESET_TIMEOUT_MS);
    const { stdout: headOut } = await gitExec(["rev-parse", "HEAD"], root, 10_000);
    const commit = headOut.trim();
    const doneAt = new Date().toISOString();
    writeGitRestoreProgress(root, { phase: "done", doneAt });
    writeUpdateRecord(root, { commit, fetchedAt: doneAt, source: "git-restore" });
    log(`git復元が完了しました（${defaultBranch}@${commit.slice(0, 7)}）。`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logFn(`git復元に失敗しました。次回起動時に再試行します: ${message}`);
    writeGitRestoreProgress(root, {
      lastError: message,
      lastAttemptAt: attemptStartedAt,
      attemptCount,
    });
  }
}

/**
 * Restores a zip-download (no `.git`) install to a real git checkout on
 * startup, so subsequent updates can use `git pull --ff-only` instead of the
 * full-tree zip overwrite. Never throws — meant to be fired without awaiting
 * from instrumentation.ts so it can't block server startup.
 */
export async function runStartupGitRestore(rootArg?: string): Promise<void> {
  if (process.env.OPENCODE_WEBUI_SKIP_GIT_RESTORE === "1") {
    log("OPENCODE_WEBUI_SKIP_GIT_RESTORE=1 のためスキップします。");
    return;
  }
  if (inFlight) return;
  inFlight = true;
  try {
    const root = rootArg ?? installationRoot();
    await attempt(root);
  } catch (err) {
    warn(`予期しないエラー: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    inFlight = false;
  }
}

/** True while a startup git restore is actively running in this process. */
export function isGitRestoreInFlight(): boolean {
  return inFlight;
}
