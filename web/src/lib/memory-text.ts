/**
 * Client-safe text helpers for the memory layer (docs/specs/memory-layer.md).
 *
 * Kept out of `./memory` because that module imports `./db` (better-sqlite3,
 * node:fs / node:os) — importing it from a "use client" component pulls the
 * Node built-ins into the browser bundle and fails `next build`.
 */

/**
 * Strips leading workspace-memory and collaboration-context blocks from user
 * text at render time. These are internal context persisted in the transcript
 * and must not be shown to the user. Returns "" when no visible text remains.
 */
export function stripMemoryInjectionBlock(text: string): string {
  let shown = text;
  const internalBlock = /^\s*<(workspace-memory|collaboration-context)>[\s\S]*?<\/\1>/;
  while (internalBlock.test(shown)) {
    shown = shown.replace(internalBlock, "").replace(/^\s*\n/, "");
  }
  return shown;
}
