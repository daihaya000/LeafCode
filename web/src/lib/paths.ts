import fs from "node:fs";
import path from "node:path";
import { dataDir, legacyDataDir, migrateLegacyDataDir } from "../../../scripts/lib/data-dir.mjs";

export { dataDir, legacyDataDir };

/**
 * Rewrite a path that still points at the pre-rebrand data directory
 * (`%APPDATA%\opencode-webui`) to the new one (`%APPDATA%\leafcode`). The
 * data-dir migration renames the whole tree, so the relative suffix under the
 * legacy data dir is preserved under the new one. Paths outside the legacy
 * data dir (project roots, external user picks) are returned unchanged.
 */
export function normalizeLegacyDataDirPath(p: string): string {
  const legacy = path.resolve(legacyDataDir());
  const resolved = path.resolve(p);
  const rel = path.relative(legacy, resolved);
  if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    return path.join(dataDir(), rel);
  }
  return p;
}

export function dbPath(): string {
  return path.join(dataDir(), "webui.db");
}

export function ensureDataDir(): void {
  migrateLegacyDataDir();
  fs.mkdirSync(dataDir(), { recursive: true });
}
