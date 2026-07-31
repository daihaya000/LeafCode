import { isAbsolute, relative, resolve } from "node:path";

/**
 * Resolve Next.js `distDir` from NEXT_DIST_DIR.
 *
 * Next.js joins `distDir` with the app directory unconditionally, even when
 * it is absolute: on Windows `join("C:\\…\\web", "C:\\…\\web-build")` yields
 * the invalid path "web\\C:\\…" and `next build` fails with ENOENT. The tray
 * host and batch scripts (single source of truth: scripts/web-dist-dir.mjs)
 * pass an absolute output directory — default under %APPDATA%, outside the
 * OneDrive-synced repo — so convert it here to a path relative to the app
 * directory. Relative inputs (e.g. `.next-e2e`, `.next-dev`) are resolved
 * against the app directory and returned relative again, keeping the
 * previous behavior.
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
  if (isAbsolute(rel)) {
    throw new Error(
      `NEXT_DIST_DIR (${fromEnv}) must be on the same drive as the web app (${appDir}); Next.js joins distDir with the app directory and cannot reach another drive.`,
    );
  }
  return rel;
}
