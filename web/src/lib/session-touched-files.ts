/**
 * Pure helper to collect the file paths (relative to the workspace
 * directory) touched by this session's own edit/write/patch-style tool
 * calls. Used to flag diff files that changed without this session's tool
 * calls touching them — a possible sign of a parallel session/process
 * editing the same directory (AGENTS.md "並列セッション前提").
 */

import { isTaskToolName } from "./match-child-session";
import type { MessageWithParts } from "./types";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** File-modifying tools only (edit/write/patch); excludes read/glob/bash
 * etc. whose input may also carry a `path`-shaped field but does not mean
 * the file was changed. */
function isFileModifyingTool(tool: string | undefined): boolean {
  if (!tool) return false;
  const t = tool.toLowerCase();
  return t.includes("edit") || t.includes("write") || t.includes("patch");
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
 * Set of file paths (relative to `directory`) touched by edit/write/patch
 * tool calls whose input carries a `filePath` / `file_path` / `path` field,
 * across all given messages. Non-tool parts, read-only tools, and failed
 * (`status: "error"`) calls are ignored.
 *
 * Bails out to an **empty set** if any `task` (subagent delegation) tool
 * call is present: a delegated subagent's own edits run in a child session
 * and are not visible in `messages`, so this session's touched-file
 * attribution would be unreliable for the whole diff — better to skip the
 * "session外?" check entirely than flag a teammate subagent's own edits as
 * external (this project delegates most implementation work by default).
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
      if (isTaskToolName(p.tool ?? "")) return new Set();
      if (p.state?.status === "error") continue;
      if (!isFileModifyingTool(p.tool)) continue;
      const input = p.state?.input ?? {};
      const raw =
        asString(input.filePath) ?? asString(input.file_path) ?? asString(input.path);
      if (!raw) continue;
      touched.add(toRelative(raw, directory));
    }
  }
  return touched;
}
