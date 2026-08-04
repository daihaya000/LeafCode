/**
 * Shared pathspec safety for git add / show file arguments.
 * Returns an error message, or null when the path is ok.
 */
export function gitPathspecError(
  p: string,
  opts?: { rejectWebuiMeta?: boolean },
): string | null {
  if (!p || typeof p !== "string") return "empty path";
  if (p.includes("\0")) return `unsafe path: ${p}`;
  if (p.includes("..") || p.startsWith("-")) return `unsafe path: ${p}`;
  // Callers pass this straight through as a pathspec relative to the repo
  // root; an absolute path (POSIX `/...` or a Windows drive/UNC path) would
  // let it reach outside the repo instead of being scoped to it.
  if (p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(p)) {
    return `unsafe path: ${p}`;
  }
  // Any magic pathspec (:(glob), :!, :^, …) can reshape the tree; clients must
  // use all:true (which applies WebUI excludes) instead of crafting these.
  if (p.startsWith(":")) return `unsafe path: ${p}`;
  if (
    p === "." ||
    p === "*" ||
    p === "**" ||
    p.includes("*") ||
    p.includes("?")
  ) {
    return `unsafe path: ${p}`;
  }
  if (opts?.rejectWebuiMeta) {
    const norm = p.replace(/\\/g, "/").replace(/^\.\//, "");
    if (
      norm === ".opencode-webui" ||
      norm.startsWith(".opencode-webui/") ||
      norm === ".webui-worktrees" ||
      norm.startsWith(".webui-worktrees/")
    ) {
      return `excluded path: ${p}`;
    }
  }
  return null;
}
