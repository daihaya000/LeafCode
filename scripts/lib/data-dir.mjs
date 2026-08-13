import { homedir } from "node:os";
import { join } from "node:path";

/**
 * WebUI machine-local data directory, shared by the web app
 * (`web/src/lib/paths.ts`), the tray host (`host/src/*`) and scripts
 * (REFACTORING_PLAN P1-c/P1-d, IMPROVEMENT 6-3 / 5-1).
 *
 * - win32: `%APPDATA%\opencode-webui` (falls back to `<home>/AppData/Roaming`)
 * - else:  `~/.opencode-webui`  (decided in REFACTORING_PLAN D2: the web path
 *   is the single source of truth; the browser-bridge used
 *   `~/.local/share/opencode-webui` before and was aligned to this)
 */
export function dataDir() {
  if (process.platform === "win32") {
    const base = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(base, "opencode-webui");
  }
  return join(homedir(), ".opencode-webui");
}
