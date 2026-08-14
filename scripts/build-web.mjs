import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeWebuiEnv } from "./lib/env-compat.mjs";
import { syncMirror } from "./web-build-mirror.mjs";

// Legacy OPENCODE_WEBUI_* env vars keep working: copy onto LEAFCODE_* first.
normalizeWebuiEnv();

/**
 * Single entry point for the production WebUI build, shared by build.bat,
 * scripts/start-webui.bat and host/src/index.js.
 *
 * The build never runs in the installation itself: it runs in the hard-link
 * mirror outside the OneDrive-synced tree (see scripts/web-build-mirror.mjs).
 * Keeping the whole project — not just its output — out of the synced tree is
 * what Next 16's Turbopack requires, since it refuses a distDir that navigates
 * out of the project.
 */

/** Sibling directory used to keep the last good `.next` across a failed rebuild. */
export function previousBuildDir(distDir) {
  return `${distDir}.prev`;
}

/**
 * Move an existing production output aside before rebuilding. Returns true when
 * a previous build was stashed. Callers must restore or discard it afterwards.
 *
 * @param {string} distDir
 * @param {{
 *   existsSync?: (path: string) => boolean,
 *   renameSync?: (from: string, to: string) => void,
 *   rmSync?: (path: string, opts: object) => void,
 * }} [fsApi]
 */
export function stashPreviousBuild(distDir, fsApi = {}) {
  const exists = fsApi.existsSync ?? existsSync;
  const rename = fsApi.renameSync ?? renameSync;
  const remove = fsApi.rmSync ?? rmSync;
  if (!exists(distDir)) return false;
  const prev = previousBuildDir(distDir);
  remove(prev, { recursive: true, force: true });
  rename(distDir, prev);
  return true;
}

/**
 * Put a stashed production output back when the rebuild fails, so EXE startup
 * can still serve the last good BUILD_ID instead of leaving the mirror empty.
 *
 * @param {string} distDir
 * @param {{
 *   existsSync?: (path: string) => boolean,
 *   renameSync?: (from: string, to: string) => void,
 *   rmSync?: (path: string, opts: object) => void,
 * }} [fsApi]
 */
export function restorePreviousBuild(distDir, fsApi = {}) {
  const exists = fsApi.existsSync ?? existsSync;
  const rename = fsApi.renameSync ?? renameSync;
  const remove = fsApi.rmSync ?? rmSync;
  const prev = previousBuildDir(distDir);
  if (!exists(prev)) return false;
  remove(distDir, { recursive: true, force: true });
  rename(prev, distDir);
  return true;
}

/**
 * Drop the stashed copy after a successful rebuild.
 *
 * @param {string} distDir
 * @param {{
 *   existsSync?: (path: string) => boolean,
 *   rmSync?: (path: string, opts: object) => void,
 * }} [fsApi]
 */
export function discardPreviousBuild(distDir, fsApi = {}) {
  const exists = fsApi.existsSync ?? existsSync;
  const remove = fsApi.rmSync ?? rmSync;
  const prev = previousBuildDir(distDir);
  if (!exists(prev)) return false;
  remove(prev, { recursive: true, force: true });
  return true;
}

const HERE = fileURLToPath(import.meta.url);
const INSTALL_ROOT = resolve(dirname(HERE), "..");

function run(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/** `next build` runs outside the repository, where `git` has nothing to read,
 *  so the commit metadata is resolved here and passed through the env. */
function gitMetadata() {
  const env = {};
  const commit =
    process.env.GIT_COMMIT ||
    (() => {
      try {
        return execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: INSTALL_ROOT,
          encoding: "utf8",
          windowsHide: true,
        }).trim();
      } catch {
        return "";
      }
    })();
  if (!commit) return env;
  env.GIT_COMMIT = commit;

  const date =
    process.env.GIT_COMMIT_DATE ||
    (() => {
      try {
        return execFileSync("git", ["show", "-s", "--format=%cI", commit], {
          cwd: INSTALL_ROOT,
          encoding: "utf8",
          windowsHide: true,
        }).trim();
      } catch {
        return "";
      }
    })();
  if (date) env.GIT_COMMIT_DATE = date;
  return env;
}

export async function main(argv = process.argv.slice(2)) {
  const skipGuard = argv.includes("--skip-guard");

  if (!skipGuard) {
    // Refuses to build on top of a running production WebUI: replacing the
    // served build mid-flight mixes chunk generations (ChunkLoadError).
    const guard = run(process.execPath, [join(INSTALL_ROOT, "scripts", "production-webui-build-guard.mjs")], {
      cwd: INSTALL_ROOT,
    });
    if (guard !== 0) return guard;
  }

  // Addon assets are generated into web/public in the installation, so the
  // mirror picks them up in the same pass below.
  const addons = run(process.execPath, [join(INSTALL_ROOT, "web", "scripts", "sync-addon-assets.mjs")], {
    cwd: join(INSTALL_ROOT, "web"),
  });
  if (addons !== 0) return addons;

  const mirror = syncMirror({ installRoot: INSTALL_ROOT });
  console.error(
    `[build-web] mirror ${mirror.mirrorRoot} (linked ${mirror.linked}, copied ${mirror.copied}, unchanged ${mirror.unchanged}, removed ${mirror.removed}, ${mirror.durationMs}ms)`,
  );

  const nextBin = join(mirror.webDir, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) {
    console.error(`[build-web] next was not found in the mirror: ${nextBin}`);
    return 1;
  }

  // A failed/cancelled Turbopack build can leave an incremental cache that
  // immediately panics on the next attempt with `AssetContent::file was
  // canceled`. Retry once from a clean generated directory. Webpack remains
  // available as an explicit diagnostic fallback, but is not the default: on
  // this application its large server route graph can leave webpack's parent
  // process waiting indefinitely after the compiler worker exits.
  const useWebpack = process.env.LEAFCODE_USE_WEBPACK === "1";
  const nextArgs = [nextBin, "build", ...(useWebpack ? ["--webpack"] : [])];
  const buildOptions = {
    cwd: mirror.webDir,
    env: {
      ...process.env,
      ...gitMetadata(),
      // The mirrored project builds into its own .next; any inherited value
      // would point at the old external output directory.
      NEXT_DIST_DIR: "",
    },
  };
  console.error(`[build-web] bundler: ${useWebpack ? "webpack" : "turbopack"}`);
  // Rebuilding means no WebUI is serving this directory (the production
  // guard has already passed). Stash the last good `.next` instead of deleting
  // it: a typecheck/Turbopack failure must not leave EXE startup without a
  // BUILD_ID (that bricks the tray host until a later successful rebuild).
  stashPreviousBuild(mirror.distDir);
  let status = run(process.execPath, nextArgs, buildOptions);
  if (status !== 0 && !useWebpack) {
    console.error("[build-web] Turbopack failed; clearing generated output and retrying once...");
    rmSync(mirror.distDir, { recursive: true, force: true });
    status = run(process.execPath, nextArgs, buildOptions);
  }
  if (status !== 0) {
    if (restorePreviousBuild(mirror.distDir)) {
      console.error(
        `[build-web] rebuild failed; restored previous production build at ${mirror.distDir}`,
      );
    }
    return status;
  }

  if (!existsSync(join(mirror.distDir, "BUILD_ID"))) {
    console.error(`[build-web] the build finished without producing ${join(mirror.distDir, "BUILD_ID")}`);
    if (restorePreviousBuild(mirror.distDir)) {
      console.error(
        `[build-web] missing BUILD_ID; restored previous production build at ${mirror.distDir}`,
      );
    }
    return 1;
  }

  discardPreviousBuild(mirror.distDir);
  console.error(`[build-web] build output: ${mirror.distDir}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === HERE) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`[build-web] failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    });
}
