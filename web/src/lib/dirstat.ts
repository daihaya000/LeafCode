import { runGit } from "./git";

export type DirStat = {
  git: boolean;
  branch: string | null;
  additions: number;
  deletions: number;
  /** changed files incl. untracked */
  files: number;
};

const cache = new Map<string, { at: number; stat: DirStat }>();

const EMPTY: DirStat = { git: false, branch: null, additions: 0, deletions: 0, files: 0 };

/** True for a `git status --porcelain` line that refers to our own metadata. */
function isMetaPath(p: string): boolean {
  const norm = p.replace(/^"|"$/g, "").replace(/\\/g, "/");
  return (
    norm === ".opencode-webui" ||
    norm.startsWith(".opencode-webui/") ||
    norm === ".webui-worktrees" ||
    norm.startsWith(".webui-worktrees/")
  );
}

/** True for a `git status --porcelain` line that refers to our own metadata. */
function isWebuiMeta(line: string): boolean {
  // Porcelain line is "XY <path>"; strip the 2-char status + space. Renames
  // and copies are "XY orig -> new" — check both sides, not just the whole
  // "orig -> new" string, or a rename into/out of our metadata dir leaks
  // into the visible file count.
  const rest = line.slice(3);
  const arrow = rest.indexOf(" -> ");
  if (arrow === -1) return isMetaPath(rest);
  return isMetaPath(rest.slice(0, arrow)) || isMetaPath(rest.slice(arrow + 4));
}

function parseShortstat(text: string): { additions: number; deletions: number } {
  const add = /(\d+) insertion/.exec(text);
  const del = /(\d+) deletion/.exec(text);
  return {
    additions: add ? Number(add[1]) : 0,
    deletions: del ? Number(del[1]) : 0,
  };
}

/**
 * Parse branch name from `git status --porcelain --branch` output.
 * The first line starts with `## ` followed by `branch` or `branch...upstream`.
 */
function parseBranch(statusOutput: string): string | null {
  const lines = statusOutput.split(/\r?\n/);
  const header = lines[0];
  if (!header || !header.startsWith("## ")) return null;
  const rest = header.slice(3);
  // Format: "branch" or "branch...upstream [ahead N, behind M]" or
  // "HEAD (no branch)" for detached HEAD.
  if (rest.startsWith("HEAD (no branch)") || rest.startsWith("HEAD (detached")) {
    return null;
  }
  const dotIdx = rest.indexOf("...");
  const branch = (dotIdx === -1 ? rest : rest.slice(0, dotIdx)).trim();
  return branch || null;
}

/**
 * Count changed files from `git status --porcelain --branch` output.
 * Skips the header line (## ...) and filters out WebUI metadata paths.
 */
function countFiles(statusOutput: string): number {
  const lines = statusOutput.split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    // The --branch header line starts with "## "
    if (line.startsWith("## ") || line.trim().length === 0) continue;
    if (!isWebuiMeta(line)) count++;
  }
  return count;
}

/**
 * Cached `git` working-tree summary for task cards.
 *
 * Uses a single `git status --porcelain --branch` command to get both the
 * branch name and changed file count in one round-trip. The diff shortstat
 * (additions/deletions) is fetched in parallel but is non-blocking — if it
 * fails, the returned stat simply has zero additions/deletions.
 */
export async function dirStat(dir: string, ttlMs = 15_000): Promise<DirStat> {
  const hit = cache.get(dir);
  if (hit && Date.now() - hit.at < ttlMs) return hit.stat;

  let stat: DirStat;
  try {
    // Single command: branch name + changed files (porcelain + branch header)
    const status = await runGit(dir, ["status", "--porcelain", "--branch"]);
    if (status.code !== 0) {
      stat = EMPTY;
    } else {
      const branch = parseBranch(status.stdout);
      const files = countFiles(status.stdout);

      // Fetch diff shortstat in parallel — non-blocking on failure.
      // HEAD may not exist in a fresh repo; fall back to plain diff.
      let additions = 0;
      let deletions = 0;
      try {
        const short = await runGit(dir, ["diff", "HEAD", "--shortstat"]);
        if (short.code !== 0) {
          const fallback = await runGit(dir, ["diff", "--shortstat"]);
          const parsed = parseShortstat(fallback.stdout);
          additions = parsed.additions;
          deletions = parsed.deletions;
        } else {
          const parsed = parseShortstat(short.stdout);
          additions = parsed.additions;
          deletions = parsed.deletions;
        }
      } catch {
        // diff failure is non-fatal — return with zero additions/deletions
      }

      stat = { git: true, branch, additions, deletions, files };
    }
  } catch {
    stat = EMPTY;
  }

  cache.set(dir, { at: Date.now(), stat });
  return stat;
}

export function invalidateDirStat(dir?: string): void {
  if (dir) cache.delete(dir);
  else cache.clear();
}