import { spawnSync, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { syncMirror } from "./web-build-mirror.mjs";

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

  const status = run(process.execPath, [nextBin, "build"], {
    cwd: mirror.webDir,
    env: {
      ...process.env,
      ...gitMetadata(),
      // The mirrored project builds into its own .next; any inherited value
      // would point at the old external output directory.
      NEXT_DIST_DIR: "",
    },
  });
  if (status !== 0) return status;

  if (!existsSync(join(mirror.distDir, "BUILD_ID"))) {
    console.error(`[build-web] the build finished without producing ${join(mirror.distDir, "BUILD_ID")}`);
    return 1;
  }

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
