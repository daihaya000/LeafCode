import { isAbsolute, relative, resolve } from "node:path";

/**
 * Resolve Next.js `distDir` from NEXT_DIST_DIR.
 *
 * The value must stay inside the app directory: Turbopack rejects a distDir
 * that navigates out of the project, and Next.js joins distDir with the app
 * directory unconditionally, so an absolute path yields the invalid
 * "web\\C:\\…". Production isolation from the OneDrive-synced tree comes from
 * building in the hard-link mirror (scripts/web-build-mirror.mjs), not from
 * pointing the output elsewhere. This only separates the in-project variants:
 * `.next` (production), `.next-dev`, `.next-e2e`.
 *
 * @param env environment carrying NEXT_DIST_DIR
 * @param appDir the Next.js app directory (the directory of next.config.ts)
 */
export function resolveNextDistDir(
  env: Record<string, string | undefined> = process.env,
  appDir: string = process.cwd(),
): string {
  const fromEnv = env.NEXT_DIST_DIR?.trim();
  if (!fromEnv) return ".next";
  const rel = relative(appDir, resolve(appDir, fromEnv));
  if (rel === "") return ".";
  if (isAbsolute(rel) || rel.startsWith("..")) {
    throw new Error(
      `NEXT_DIST_DIR (${fromEnv}) must be inside the web app (${appDir}). Production builds run in the build mirror (scripts/web-build-mirror.mjs) instead of writing outside the project.`,
    );
  }
  return rel;
}
