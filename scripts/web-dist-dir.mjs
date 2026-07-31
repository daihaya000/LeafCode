import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the production WebUI build output directory (Next.js distDir).
 *
 * Single source of truth shared by host/src/index.js, build.bat, and
 * scripts/start-webui.bat. Keeps the production build output out of the
 * OneDrive-synced repository (web/.next) so concurrent sync never corrupts a
 * live build (ChunkLoadError). Dev uses .next-dev and e2e uses .next-e2e,
 * both untouched. Override with OPENCODE_WEBUI_DIST_DIR.
 *
 * Priority:
 * 1. OPENCODE_WEBUI_DIST_DIR (absolute; relative resolves against cwd)
 * 2. %APPDATA%\opencode-webui\web-build
 * 3. <webDir>/.next  (when webDir is given)
 * 4. ".next"
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [webDir]
 * @returns {string}
 */
export function resolveProductionDistDir(env = process.env, webDir = undefined) {
  const explicit = env.OPENCODE_WEBUI_DIST_DIR?.trim();
  if (explicit) return resolve(explicit);

  const appData = env.APPDATA?.trim();
  if (appData) return join(appData, "opencode-webui", "web-build");

  if (webDir) return join(webDir, ".next");

  return ".next";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(resolveProductionDistDir());
}
