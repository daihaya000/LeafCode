import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const GITHUB_REPO = "daihaya000/LeafCode";
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}.git`;

/**
 * Resolves the on-disk root of the WebUI installation (the repo/zip root, one
 * level above `web/`).
 *
 * In production the server runs from the build mirror outside the synced tree
 * (scripts/web-build-mirror.mjs), so `process.cwd()` points at a copy rather
 * than the installation. Git-backed features — self-update, git-restore,
 * OpenCode config paths — must still act on the real installation, so the host
 * passes it through `OPENCODE_WEBUI_INSTALL_ROOT`.
 */
export function installationRoot(): string {
  const fromEnv = process.env.OPENCODE_WEBUI_INSTALL_ROOT?.trim();
  if (fromEnv) return resolve(fromEnv);

  const root = resolve(process.cwd(), "..");
  return existsSync(join(root, "scripts")) ? root : process.cwd();
}

export function isGitInstall(root: string): boolean {
  return existsSync(join(root, ".git"));
}
