import fs from "node:fs";
import path from "node:path";
import { dataDir, ensureDataDir } from "./paths";

const SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".webui-worktrees",
  ".webui-copies",
  "coverage",
  ".turbo",
]);

export function temporaryCopyRoot(): string {
  ensureDataDir();
  const root = path.join(dataDir(), "copies");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Copy project tree into APPDATA copies/<id>, skipping heavy/vcs dirs. */
export function createTemporaryCopy(sourceRoot: string, id: string): string {
  const root = path.resolve(temporaryCopyRoot());
  const dest = path.resolve(root, id);

  // A copy id must identify exactly one direct child of the copies root. This
  // prevents a malformed id from causing rollback to affect another copy.
  if (path.dirname(dest) !== root) {
    throw new Error("temporary copy destination must be a direct child of copies root");
  }

  let created = false;
  try {
    // Do not merge with an existing copy: if this fails, it was not created by
    // this call and therefore must never be included in rollback.
    fs.mkdirSync(dest);
    created = true;
    fs.cpSync(sourceRoot, dest, {
      recursive: true,
      dereference: false,
      filter: (src) => !SKIP.has(path.basename(src)),
    });
    removeOutwardSymlinks(dest, dest);
    return dest;
  } catch (err) {
    if (created) {
      try {
        removeTemporaryCopy(dest);
      } catch {
        /* best effort rollback */
      }
    }
    throw err;
  }
}

/** Remove symlinks that resolve outside `copyRoot` without traversing links. */
function removeOutwardSymlinks(current: string, copyRoot: string): void {
  for (const entry of fs.readdirSync(current)) {
    const entryPath = path.join(current, entry);
    const stat = fs.lstatSync(entryPath);

    if (stat.isSymbolicLink()) {
      const resolvedTarget = path.resolve(current, fs.readlinkSync(entryPath));
      if (!isDescendantOrSame(copyRoot, resolvedTarget)) {
        fs.rmSync(entryPath, { force: true });
      }
      // Do not follow an inward symlink: the target is already visited through
      // its real directory entry, and following it can introduce a cycle.
      continue;
    }

    if (stat.isDirectory()) {
      removeOutwardSymlinks(entryPath, copyRoot);
    }
  }
}

function isDescendantOrSame(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`));
}

export function removeTemporaryCopy(copyPath: string): void {
  const root = path.resolve(temporaryCopyRoot());
  const resolved = path.resolve(copyPath);
  // Require an exact parent match, rather than a prefix/descendant check, so a
  // cleanup request cannot delete the copies root or traverse into another
  // copy's nested path.
  if (path.dirname(resolved) !== root) {
    throw new Error("refusing to delete path outside copies root");
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}
