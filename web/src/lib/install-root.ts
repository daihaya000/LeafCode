import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const GITHUB_REPO = "daihaya000/OpenCodeWebUI";
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}.git`;

/** Resolves the on-disk root of the WebUI installation (the repo/zip root, one level above `web/`). */
export function installationRoot(): string {
  const root = resolve(process.cwd(), "..");
  return existsSync(join(root, "scripts")) ? root : process.cwd();
}

export function isGitInstall(root: string): boolean {
  return existsSync(join(root, ".git"));
}
