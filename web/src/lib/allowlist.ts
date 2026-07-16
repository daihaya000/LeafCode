import fs from "node:fs";
import path from "node:path";
import { addAllowedRoot, listAllowedRoots } from "./db";

function normalize(p: string): string {
  return path.resolve(p);
}

/** Resolve real path if possible; fall back to resolved path. */
export function realPathOrResolved(p: string): string {
  const resolved = normalize(p);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function isUnder(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Phase 0: directory must be under an allowed root.
 * Symlinks: real path must also stay under an allowed root.
 */
export function assertAllowedDirectory(directory: string): {
  ok: true;
  path: string;
} | { ok: false; status: number; error: string } {
  if (!directory || typeof directory !== "string") {
    return { ok: false, status: 400, error: "directory is required" };
  }

  const resolved = normalize(directory);
  let real: string;
  try {
    real = fs.realpathSync.native(resolved);
  } catch {
    // Path may not exist yet; still require allowlist on resolved form
    real = resolved;
  }

  const roots = listAllowedRoots().map((r) => realPathOrResolved(r));
  if (roots.length === 0) {
    return {
      ok: false,
      status: 403,
      error: "no allowed roots configured; add one via /api/roots",
    };
  }

  const allowed = roots.some((root) => isUnder(root, resolved) && isUnder(root, real));
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error: "directory is outside allowed roots (or symlink escapes allowlist)",
    };
  }

  return { ok: true, path: resolved };
}

export function ensureBootstrapRoot(candidate?: string): string[] {
  const roots = listAllowedRoots();
  if (roots.length > 0) return roots;
  if (candidate) {
    addAllowedRoot(normalize(candidate));
  }
  return listAllowedRoots();
}
