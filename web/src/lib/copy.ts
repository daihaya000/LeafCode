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
  const dest = path.join(temporaryCopyRoot(), id);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(sourceRoot, dest, {
    recursive: true,
    dereference: false,
    filter: (src) => {
      const base = path.basename(src);
      if (SKIP.has(base)) return false;
      return true;
    },
  });
  return dest;
}

export function removeTemporaryCopy(copyPath: string): void {
  const root = path.resolve(temporaryCopyRoot());
  const resolved = path.resolve(copyPath);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("refusing to delete path outside copies root");
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}
