/**
 * Reject pathspecs that bypass the all:true metadata excludes or that are
 * magic/glob forms. Returns an error message, or null when the path is ok.
 */
export function commitPathError(p: string): string | null {
  if (!p || typeof p !== "string") return "empty path";
  if (p.includes("\0")) return `unsafe path: ${p}`;
  if (p.includes("..") || p.startsWith("-")) return `unsafe path: ${p}`;
  // Magic pathspecs / globs: use all:true (which applies excludes) instead.
  if (
    p.startsWith(":(") ||
    p.startsWith(":!") ||
    p === "." ||
    p === "*" ||
    p === "**" ||
    p.includes("*") ||
    p.includes("?")
  ) {
    return `unsafe path: ${p}`;
  }
  const norm = p.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    norm === ".opencode-webui" ||
    norm.startsWith(".opencode-webui/") ||
    norm === ".webui-worktrees" ||
    norm.startsWith(".webui-worktrees/")
  ) {
    return `excluded path: ${p}`;
  }
  return null;
}
