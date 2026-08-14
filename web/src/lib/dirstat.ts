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

import { isProjectMetaPath } from "./project-meta";

/** True for a `git status --porcelain` line that refers to our own metadata. */
function isMetaPath(p: string): boolean {
  const norm = p.replace(/^"|"$/g, "").replace(/\\/g, "/");
  return isProjectMetaPath(norm);
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

/**
 * Expand a `--numstat` path field into every path it refers to.
 *
 * Plain entries are a single path. Renames/copies (`-M`) are either
 * `old => new` or the brace-compressed `pre{old => new}post` form, and both
 * sides have to be checked so a rename into/out of our metadata dir does not
 * leak into the visible file count.
 */
function numstatPaths(field: string): string[] {
  const raw = field.replace(/^"|"$/g, "");
  if (!raw.includes(" => ")) return [raw];
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw);
  if (brace) {
    const [, pre, from, to, post] = brace;
    // Braces collapse an empty segment to "", which leaves a double slash.
    const join = (mid: string) => `${pre}${mid}${post}`.replace(/\/{2,}/g, "/");
    return [join(from), join(to)];
  }
  const arrow = raw.indexOf(" => ");
  return [raw.slice(0, arrow), raw.slice(arrow + 4)];
}

type NumstatSummary = {
  additions: number;
  deletions: number;
  /** Post-image paths of changed tracked files, metadata excluded. */
  paths: Set<string>;
};

/**
 * Parse `git diff --numstat` into additions/deletions plus the changed paths.
 *
 * Counting tracked changes from the real diff — instead of from
 * `git status --porcelain` — is what keeps the "変更あり" badge honest on
 * Windows. `git status` reports a file as modified whenever its on-disk size
 * differs from the size cached in the index, and with `core.autocrlf=true` a
 * CRLF working copy of an LF blob always differs in size (one byte per line).
 * Such an entry produces no diff at all, so the badge used to say 変更あり
 * while the Diff tab showed nothing.
 */
function parseNumstat(text: string, into?: NumstatSummary): NumstatSummary {
  const summary: NumstatSummary =
    into ?? { additions: 0, deletions: 0, paths: new Set<string>() };
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [add, del, ...rest] = parts;
    const field = rest.join("\t");
    const paths = numstatPaths(field);
    if (paths.some((p) => isMetaPath(p))) continue;
    // Binary files report "-" instead of a line count.
    summary.additions += add === "-" ? 0 : Number(add) || 0;
    summary.deletions += del === "-" ? 0 : Number(del) || 0;
    summary.paths.add(paths[paths.length - 1].replace(/\\/g, "/"));
  }
  return summary;
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
 * Count untracked entries ("?? ...") from `git status --porcelain --branch`.
 *
 * Tracked changes are counted from `git diff --numstat` instead, because
 * `git status` also reports size-only phantom modifications (see
 * `parseNumstat`). Untracked files have no diff to count, so they still come
 * from status.
 */
function countUntracked(statusOutput: string): number {
  const lines = statusOutput.split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    if (!line.startsWith("??")) continue;
    if (!isWebuiMeta(line)) count++;
  }
  return count;
}

/**
 * Cached `git` working-tree summary for task cards.
 *
 * `git status --porcelain --branch` supplies the branch name and the untracked
 * entries; tracked changes (count + additions/deletions) come from
 * `git diff HEAD --numstat` so the count always matches what the Diff tab can
 * actually render. The numstat call is non-blocking — if it fails, the stat
 * falls back to untracked-only counts.
 */
export async function dirStat(dir: string, ttlMs = 15_000): Promise<DirStat> {
  const hit = cache.get(dir);
  if (hit && Date.now() - hit.at < ttlMs) return hit.stat;

  let stat: DirStat;
  try {
    // Branch name + untracked entries in one round-trip.
    const status = await runGit(dir, ["status", "--porcelain", "--branch"]);
    if (status.code !== 0) {
      stat = EMPTY;
    } else {
      const branch = parseBranch(status.stdout);
      const untracked = countUntracked(status.stdout);

      // Tracked changes from the real diff — non-blocking on failure.
      // HEAD may not exist in a fresh repo; fall back to worktree + index.
      let tracked: NumstatSummary = {
        additions: 0,
        deletions: 0,
        paths: new Set<string>(),
      };
      try {
        const head = await runGit(dir, ["diff", "HEAD", "--numstat", "-M"]);
        if (head.code === 0) {
          tracked = parseNumstat(head.stdout);
        } else {
          const [unstaged, staged] = await Promise.all([
            runGit(dir, ["diff", "--numstat", "-M"]),
            runGit(dir, ["diff", "--cached", "--numstat", "-M"]),
          ]);
          parseNumstat(unstaged.stdout, tracked);
          parseNumstat(staged.stdout, tracked);
        }
      } catch {
        // diff failure is non-fatal — untracked entries still count
      }

      stat = {
        git: true,
        branch,
        additions: tracked.additions,
        deletions: tracked.deletions,
        files: tracked.paths.size + untracked,
      };
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