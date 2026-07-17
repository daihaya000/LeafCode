/**
 * Worktree branch naming rule:
 *   webui/{base}/{slug}-{id8}
 * - base: fork-from branch leaf (default main)
 * - slug: ASCII title slug, or "task" when title is non-ASCII / too short
 * - id8: first 8 hex chars of workspace id
 */

function sanitizeBranchSegment(raw: string, max: number): string {
  // Strip leading/trailing dots as well as dashes: git's check-ref-format
  // rejects any slash-separated component that starts with "." or ends with "."
  // (or ".lock"), so a title like ".gitignore を修正" must not yield
  // "webui/main/.gitignore-<id>" which git refuses (worktree add → HTTP 500).
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.+/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, max)
    .replace(/^[.-]+|[.-]+$/g, "");
}

export function makeWorktreeBranchName(input: {
  displayName: string;
  workspaceId: string;
  baseBranch?: string;
}): string {
  const baseRaw = input.baseBranch?.trim() || "main";
  const baseLeaf = baseRaw.includes("/")
    ? baseRaw.slice(baseRaw.lastIndexOf("/") + 1)
    : baseRaw;
  const base = sanitizeBranchSegment(baseLeaf, 32) || "main";
  const slug = sanitizeBranchSegment(input.displayName, 24);
  const usableSlug = slug.length >= 2 ? slug : "task";
  const id8 = input.workspaceId.replace(/-/g, "").slice(0, 8) || "00000000";
  return `webui/${base}/${usableSlug}-${id8}`;
}
