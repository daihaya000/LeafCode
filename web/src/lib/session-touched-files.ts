/**
 * Pure helper to collect the file paths (relative to the workspace
 * directory) touched by this session's own edit/write/patch-style tool
 * calls. Used to flag diff files that changed without this session's tool
 * calls touching them — a possible sign of a parallel session/process
 * editing the same directory (AGENTS.md "並列セッション前提").
 */

import type { MessageWithParts } from "./types";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Normalize to forward slashes and strip a leading `directory/` prefix so
 * absolute tool-call paths match the repo-relative paths from the diff API. */
function toRelative(raw: string, directory: string): string {
  const norm = raw.replace(/\\/g, "/");
  const dir = directory.replace(/\\/g, "/").replace(/\/+$/, "");
  if (dir && norm.toLowerCase().startsWith(`${dir.toLowerCase()}/`)) {
    return norm.slice(dir.length + 1);
  }
  return norm.replace(/^\.\//, "");
}

/**
 * Set of file paths (relative to `directory`) touched by tool calls whose
 * input carries a `filePath` / `file_path` / `path` field, across all given
 * messages. Non-tool parts and tool calls without a path field are ignored.
 */
export function extractSessionTouchedPaths(
  messages: MessageWithParts[],
  directory: string,
): Set<string> {
  const touched = new Set<string>();
  if (!directory) return touched;
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type !== "tool") continue;
      const input = p.state?.input ?? {};
      const raw =
        asString(input.filePath) ?? asString(input.file_path) ?? asString(input.path);
      if (!raw) continue;
      touched.add(toRelative(raw, directory));
    }
  }
  return touched;
}
