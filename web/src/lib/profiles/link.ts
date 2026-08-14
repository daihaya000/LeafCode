import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  globalConfigLinkPath,
  isInside,
  PENDING_COPY_PREFIX,
  profilesRoot,
  SWAP_LINK_PREFIX,
} from "./paths";
import type { LinkInfo } from "./types";

function lstatSafe(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

/**
 * Remove a reparse point / symlink *without touching its target*.
 *
 * On Windows a directory symlink or junction is removed with `rmdir`, which
 * detaches the reparse point and leaves the target untouched. `fs.rm` with
 * `recursive: true` must never be used here.
 */
export function removeLink(linkPath: string): void {
  if (process.platform === "win32") {
    fs.rmdirSync(linkPath);
  } else {
    fs.unlinkSync(linkPath);
  }
}

/** Inspect `~/.config/opencode` (or an explicit path, for tests). */
export function readLinkState(linkPath: string = globalConfigLinkPath()): LinkInfo {
  const stat = lstatSafe(linkPath);
  if (!stat) return { state: "missing", target: null };
  if (stat.isSymbolicLink()) {
    try {
      const raw = fs.readlinkSync(linkPath);
      const resolved = path.isAbsolute(raw)
        ? path.resolve(raw)
        : path.resolve(path.dirname(linkPath), raw);
      return { state: "link", target: resolved };
    } catch {
      return { state: "link", target: null };
    }
  }
  if (stat.isDirectory()) return { state: "realdir", target: null };
  return { state: "realdir", target: null };
}

/** A directory only counts as a profile when it looks like an OpenCode config dir. */
export function isValidProfileDir(dir: string): boolean {
  const markers = [
    "opencode.jsonc",
    "opencode.json",
    "agents",
    "agent",
    "skills",
  ];
  return markers.some((marker) => {
    try {
      return fs.existsSync(path.join(dir, marker));
    } catch {
      return false;
    }
  });
}

function randomSuffix(): string {
  return randomBytes(6).toString("hex");
}

/**
 * Repoint the global config link at `nextTarget`.
 *
 * Near-atomic: the replacement junction is created under a temporary name
 * first, so the window in which `~/.config/opencode` does not exist is a single
 * `rename`. On failure the previous target is restored.
 *
 * Never deletes directory contents — only the reparse point is replaced.
 */
export function swapLink(
  nextTarget: string,
  linkPath: string = globalConfigLinkPath(),
): void {
  const target = path.resolve(nextTarget);

  // A first-run installation may not have created ~/.config yet.
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });

  if (!isValidProfileDir(target)) {
    throw new Error(
      `${target} は LeafCode の設定ディレクトリとして認識できません。`,
    );
  }

  const before = readLinkState(linkPath);
  if (before.state === "realdir") {
    throw new Error(
      `${linkPath} が実体ディレクトリのため切り替えられません。手動で退避してから再実行してください。`,
    );
  }

  const tmp = path.join(
    path.dirname(linkPath),
    `${SWAP_LINK_PREFIX}${randomSuffix()}`,
  );

  fs.symlinkSync(target, tmp, "junction");

  try {
    if (before.state === "link") removeLink(linkPath);
    fs.renameSync(tmp, linkPath);
  } catch (err) {
    // Drop the temporary link, then put the previous target back if the swap
    // tore down the original before failing.
    if (lstatSafe(tmp)) {
      try {
        removeLink(tmp);
      } catch {
        /* best effort */
      }
    }
    if (before.state === "link" && before.target && !lstatSafe(linkPath)) {
      try {
        fs.symlinkSync(before.target, linkPath, "junction");
      } catch {
        /* best effort */
      }
    }
    throw err;
  }
}

/**
 * Delete a directory tree we created ourselves.
 *
 * Refuses anything that is not a real directory inside `profilesRoot()`, so a
 * stray link can never be followed. `fs.rmSync` unlinks symlinks rather than
 * descending into them, which keeps copied `node_modules` links safe.
 */
function removePendingCopy(dir: string): void {
  if (!isInside(profilesRoot(), dir)) return;
  const stat = lstatSafe(dir);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Remove leftovers from an interrupted swap or copy.
 *
 * Stale swap links are detached (never their targets); unpublished copies under
 * `profilesRoot()` are deleted because they were never exposed as profiles.
 */
export function cleanupStaleArtifacts(
  linkPath: string = globalConfigLinkPath(),
): void {
  const linkDir = path.dirname(linkPath);
  try {
    for (const entry of fs.readdirSync(linkDir)) {
      if (!entry.startsWith(SWAP_LINK_PREFIX)) continue;
      const full = path.join(linkDir, entry);
      const stat = lstatSafe(full);
      if (stat?.isSymbolicLink()) {
        try {
          removeLink(full);
        } catch {
          /* best effort */
        }
      }
    }
  } catch {
    /* directory may not exist yet */
  }

  const root = profilesRoot();
  try {
    for (const entry of fs.readdirSync(root)) {
      if (!entry.startsWith(PENDING_COPY_PREFIX)) continue;
      try {
        removePendingCopy(path.join(root, entry));
      } catch {
        /* best effort */
      }
    }
  } catch {
    /* directory may not exist yet */
  }
}
