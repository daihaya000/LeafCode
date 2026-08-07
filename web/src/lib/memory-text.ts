/**
 * Client-safe text helpers for the memory layer (docs/specs/memory-layer.md).
 *
 * Kept out of `./memory` because that module imports `./db` (better-sqlite3,
 * node:fs / node:os) — importing it from a "use client" component pulls the
 * Node built-ins into the browser bundle and fails `next build`.
 */

/**
 * Strips a leading `<workspace-memory>…</workspace-memory>` block from user
 * text at render time. The block is internal context injected into the first
 * goal-loop message and must not be shown to the user. Returns "" when the
 * whole text was just the block.
 */
export function stripMemoryInjectionBlock(text: string): string {
  const match = text.match(/^\s*<workspace-memory>[\s\S]*?<\/workspace-memory>/);
  if (!match) return text;
  return text.slice(match[0].length).replace(/^\s*\n/, "");
}
