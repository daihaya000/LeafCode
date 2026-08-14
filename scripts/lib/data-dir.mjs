import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * LeafCode machine-local data directory, shared by the web app
 * (`web/src/lib/paths.ts`), the tray host (`host/src/*`) and scripts.
 *
 * - win32: `%APPDATA%\leafcode` (falls back to `<home>/AppData/Roaming`)
 * - else:  `~/.leafcode`
 *
 * Renamed from `opencode-webui` (previously the single source of truth for
 * the WebUI family; REFACTORING_PLAN D2 aligned the browser-bridge onto it).
 * Existing installations keep their data via migrateLegacyDataDir().
 */
export const DATA_DIR_NAME = "leafcode";
export const LEGACY_DATA_DIR_NAME = "opencode-webui";

export function dataDir() {
  if (process.platform === "win32") {
    const base = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(base, DATA_DIR_NAME);
  }
  return join(homedir(), `.${DATA_DIR_NAME}`);
}

/**
 * The pre-rebrand data directory (`%APPDATA%\opencode-webui` / `~/.opencode-webui`).
 * Read-only legacy location: migrateLegacyDataDir() moves it once; nothing
 * should be written here anymore.
 */
export function legacyDataDir() {
  if (process.platform === "win32") {
    const base = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(base, LEGACY_DATA_DIR_NAME);
  }
  return join(homedir(), `.${LEGACY_DATA_DIR_NAME}`);
}

/**
 * One-shot migration: rename the legacy `opencode-webui` data dir to the
 * LeafCode name. Idempotent and safe by construction:
 *
 * - new dir already exists → nothing to do (and never overwrite it)
 * - legacy dir absent     → nothing to do (fresh install)
 * - rename within the same volume is atomic-ish and instantaneous
 *
 * Returns true when a migration actually ran. Callers should run this before
 * creating the new data dir (e.g. inside ensureDataDir()); the rename can
 * fail when the legacy host still holds files open — the error is swallowed so
 * the app keeps starting and the next launch retries.
 */
export function migrateLegacyDataDir() {
  const current = dataDir();
  const legacy = legacyDataDir();
  if (current === legacy) return false;
  if (existsSync(current)) return false;
  if (!existsSync(legacy)) return false;
  try {
    renameSync(legacy, current);
    return true;
  } catch {
    return false;
  }
}
