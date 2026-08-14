import { createHash } from "node:crypto";
import {
  copyFileSync,
  linkSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
} from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Hard-link mirror of the installation, used as the Next.js project root for
 * production builds.
 *
 * Why a mirror at all: the repository usually lives inside a OneDrive-synced
 * folder, and letting the sync client touch a build that is being written (or
 * served) mixes chunk generations and produces ChunkLoadError. The previous
 * answer was an external `distDir`, but Next 16's Turbopack rejects a distDir
 * that navigates out of the project ("Invalid distDirRoot"), so the whole
 * project — not just its output — has to sit outside the synced tree.
 *
 * Why hard links: a byte copy of the installation is ~530MB / 36k files.
 * Hard links cost no additional disk and mirror in seconds. Junctions and
 * symlinks were tried first and do not work: bundlers canonicalize reparse
 * points, so every module resolves back to its OneDrive path and the build
 * fails. Hard links are not reparse points, so the mirror looks like plain
 * files. Cross-volume installs (mirror and repo on different drives) cannot
 * be hard-linked, so those fall back to a byte copy.
 *
 * Hazard: a hard link shares its contents with the source, so anything the
 * build writes in place would also rewrite the repository's file. Paths the
 * build is known to touch are therefore copied instead of linked — see
 * COPY_INSTEAD_OF_LINK.
 */

const HERE = fileURLToPath(import.meta.url);
const DEFAULT_INSTALL_ROOT = resolve(HERE, "..", "..");

/** Never mirrored: VCS metadata, build outputs and test scratch space. */
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".next-dev",
  ".next-e2e",
  "test-results",
  "playwright-report",
  ".playwright-cli",
]);

const SKIP_FILES = new Set(["tsconfig.tsbuildinfo"]);

/**
 * Copied, not linked. `next build` rewrites tsconfig.json / next-env.d.ts, and
 * `sync:addons` writes into web/public; an in-place write through a hard link
 * would silently edit the repository.
 */
const COPY_INSTEAD_OF_LINK = [
  join("web", "tsconfig.json"),
  join("web", "next-env.d.ts"),
  join("web", "public") + sep,
];

/** Stable per-installation mirror name, so two checkouts never share one. */
export function mirrorSlug(installRoot) {
  const normalized = resolve(installRoot).replaceAll("/", "\\").toLowerCase();
  const digest = createHash("sha1").update(normalized).digest("hex").slice(0, 8);
  return `${basename(normalized) || "install"}-${digest}`;
}

/**
 * Mirror root for an installation.
 * Priority: LEAFCODE_BUILD_DIR → %LOCALAPPDATA%\opencode-webui\build\<slug>
 * → %APPDATA%\... → <installRoot>\.build-mirror (last resort, e.g. no env at all).
 */
export function resolveMirrorRoot(env = process.env, installRoot = DEFAULT_INSTALL_ROOT) {
  const explicit = env.LEAFCODE_BUILD_DIR?.trim();
  if (explicit) return resolve(explicit);

  const base = env.LOCALAPPDATA?.trim() || env.APPDATA?.trim();
  if (base) return join(base, "opencode-webui", "build", mirrorSlug(installRoot));

  return join(resolve(installRoot), ".build-mirror");
}

/** The mirrored `web/` directory — the Next.js project root for the build. */
export function mirrorWebDir(mirrorRoot) {
  return join(mirrorRoot, "web");
}

/** Production build output, always inside the mirrored project (Turbopack). */
export function mirrorDistDir(mirrorRoot) {
  return join(mirrorWebDir(mirrorRoot), ".next");
}

function shouldCopy(relPath) {
  const normalized = relPath.replaceAll("/", sep);
  return COPY_INSTEAD_OF_LINK.some((entry) =>
    entry.endsWith(sep) ? normalized.startsWith(entry) : normalized === entry,
  );
}

/** Same content already in place? Hard links share mtime/size with the source. */
function isUpToDate(sourceStat, targetStat) {
  return (
    targetStat.size === sourceStat.size &&
    Math.abs(targetStat.mtimeMs - sourceStat.mtimeMs) < 2
  );
}

function placeFile(from, to, relPath, stats) {
  if (shouldCopy(relPath)) {
    copyFileSync(from, to);
    utimesSync(to, stats.atime, stats.mtime);
    return "copied";
  }
  try {
    linkSync(from, to);
    return "linked";
  } catch (err) {
    // EXDEV: mirror is on another volume. EPERM/EACCES: filesystem refuses
    // hard links. Either way a byte copy still produces a correct mirror.
    if (err.code !== "EXDEV" && err.code !== "EPERM" && err.code !== "EACCES") throw err;
    copyFileSync(from, to);
    utimesSync(to, stats.atime, stats.mtime);
    return "copied";
  }
}

function syncDir(sourceDir, targetDir, rootDir, counters) {
  mkdirSync(targetDir, { recursive: true });

  const sourceEntries = readdirSync(sourceDir, { withFileTypes: true });
  const keep = new Set();

  for (const entry of sourceEntries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    if (entry.isFile() && SKIP_FILES.has(entry.name)) continue;
    // Reparse points in the source are skipped: mirroring them would
    // reintroduce the canonicalization problem hard links exist to avoid.
    if (entry.isSymbolicLink()) continue;

    const from = join(sourceDir, entry.name);
    const to = join(targetDir, entry.name);
    keep.add(entry.name);

    if (entry.isDirectory()) {
      syncDir(from, to, rootDir, counters);
      continue;
    }
    if (!entry.isFile()) continue;

    const relPath = relative(rootDir, from);
    const sourceStat = statSync(from);
    let targetStat;
    try {
      targetStat = statSync(to);
    } catch {
      targetStat = undefined;
    }
    if (targetStat && isUpToDate(sourceStat, targetStat)) {
      counters.unchanged += 1;
      continue;
    }
    if (targetStat) unlinkSync(to);
    const how = placeFile(from, to, relPath, sourceStat);
    counters[how] += 1;
  }

  // Prune what the source no longer has. The build output lives in
  // web/.next, which the source never contains, so it is preserved by the
  // SKIP_DIRS check above.
  for (const entry of readdirSync(targetDir, { withFileTypes: true })) {
    if (keep.has(entry.name)) continue;
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    rmSync(join(targetDir, entry.name), { recursive: true, force: true });
    counters.removed += 1;
  }
}

/**
 * Bring the mirror in line with the installation and return where things went.
 *
 * @param {{ installRoot?: string, mirrorRoot?: string, env?: NodeJS.ProcessEnv }} [options]
 */
export function syncMirror(options = {}) {
  const installRoot = resolve(options.installRoot ?? DEFAULT_INSTALL_ROOT);
  const env = options.env ?? process.env;
  const mirrorRoot = resolve(options.mirrorRoot ?? resolveMirrorRoot(env, installRoot));

  if (mirrorRoot === installRoot || mirrorRoot.startsWith(installRoot + sep)) {
    throw new Error(
      `The build mirror (${mirrorRoot}) must not live inside the installation (${installRoot}).`,
    );
  }

  const counters = { linked: 0, copied: 0, unchanged: 0, removed: 0 };
  const startedAt = Date.now();
  syncDir(installRoot, mirrorRoot, installRoot, counters);

  return {
    installRoot,
    mirrorRoot,
    webDir: mirrorWebDir(mirrorRoot),
    distDir: mirrorDistDir(mirrorRoot),
    durationMs: Date.now() - startedAt,
    ...counters,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === HERE) {
  if (process.argv.includes("--path")) {
    console.log(resolveMirrorRoot());
  } else if (process.argv.includes("--dist-dir")) {
    console.log(mirrorDistDir(resolveMirrorRoot()));
  } else {
    const result = syncMirror();
    console.error(
      `[web-build-mirror] ${result.mirrorRoot} (linked ${result.linked}, copied ${result.copied}, unchanged ${result.unchanged}, removed ${result.removed}, ${result.durationMs}ms)`,
    );
    console.log(result.mirrorRoot);
  }
}
