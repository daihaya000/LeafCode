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
function isWebuiMeta(line: string): boolean {
  // Porcelain line is "XY <path>"; strip the 2-char status + space.
  const p = line.slice(3).replace(/^"|"$/g, "").replace(/\\/g, "/");
  return (
    p === ".opencode-webui" ||
    p.startsWith(".opencode-webui/") ||
    p === ".webui-worktrees" ||
    p.startsWith(".webui-worktrees/")
  );
}

function parseShortstat(text: string): { additions: number; deletions: number } {
  const add = /(\d+) insertion/.exec(text);
  const del = /(\d+) deletion/.exec(text);
  return {
    additions: add ? Number(add[1]) : 0,
    deletions: del ? Number(del[1]) : 0,
  };
}

/** Cached `git` working-tree summary for task cards. */
export async function dirStat(dir: string, ttlMs = 15_000): Promise<DirStat> {
  const hit = cache.get(dir);
  if (hit && Date.now() - hit.at < ttlMs) return hit.stat;

  let stat: DirStat;
  try {
    const head = await runGit(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (head.code !== 0) {
      stat = EMPTY;
    } else {
      const branch = head.stdout.trim() || null;
      // HEAD may not exist in a fresh repo; fall back to plain diff
      let short = await runGit(dir, ["diff", "HEAD", "--shortstat"]);
      if (short.code !== 0) {
        short = await runGit(dir, ["diff", "--shortstat"]);
      }
      const { additions, deletions } = parseShortstat(short.stdout);
      const status = await runGit(dir, ["status", "--porcelain"]);
      const files =
        status.code === 0
          ? status.stdout
              .split(/\r?\n/)
              .filter((l) => l.trim().length > 0)
              .filter((l) => !isWebuiMeta(l))
              .length
          : 0;
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
