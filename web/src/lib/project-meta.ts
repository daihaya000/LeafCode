/**
 * Project-level metadata directory names that belong to LeafCode (and the
 * pre-rebrand names that may still exist in repositories cloned before the
 * rename). Keep this list in sync across the pathspec/dirstat/copy/commit
 * exclusions: the legacy names must stay excluded so leftover directories in
 * older clones are never committed by "commit everything".
 */
export const PROJECT_META_DIR = ".leafcode";

export const PROJECT_META_DIRS = [
  PROJECT_META_DIR,
  ".opencode-webui",
  ".webui-worktrees",
  ".webui-copies",
] as const;

/** True when a normalized (forward-slash, no leading "./") relative path refers to our own metadata. */
export function isProjectMetaPath(norm: string): boolean {
  return PROJECT_META_DIRS.some(
    (dir) => norm === dir || norm.startsWith(`${dir}/`),
  );
}
