import {
  existsSync as defaultExistsSync,
  readdirSync as defaultReaddirSync,
  statSync as defaultStatSync,
} from 'fs';
import { join } from 'path';

/** Source roots and config files that invalidate a production `.next` build. */
const WATCHED_ROOT_FILES = [
  'package.json',
  'package-lock.json',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'tsconfig.json',
  'postcss.config.mjs',
  'postcss.config.js',
  'tailwind.config.ts',
  'tailwind.config.js',
  'middleware.ts',
  'middleware.js',
];

const WATCHED_DIRS = ['src', 'public'];
/** Sibling of `web/` — repo-root addons (CodexBar etc.). */
const WATCHED_SIBLING_DIRS = ['addons'];

const WATCHED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.sass',
  '.json',
  '.mdx',
  '.svg',
]);

/**
 * Resolve how the tray host should launch the WebUI.
 * @param {string | undefined} mode
 * @param {boolean} hasBuild
 * @param {boolean} [buildStale=false]
 */
export function getWebLaunchPlan(mode, hasBuild, buildStale = false) {
  const explicitProd = mode === 'prod';
  const explicitDev = mode === 'dev';
  const useProd = explicitProd || (!explicitDev && hasBuild);
  return {
    needsBuild: useProd && (!hasBuild || Boolean(buildStale)),
    useProd,
  };
}

/**
 * Plan for the retry that follows a rebuild. A freshly built tree must never be
 * rejected just because a source file changed while the build ran (parallel
 * agent edits / OneDrive sync touch mtimes mid-build). Only a missing BUILD_ID
 * is fatal here; renewed staleness is reported for logging and deferred to the
 * next restart.
 *
 * @param {string | undefined} mode
 * @param {boolean} hasBuild
 * @param {boolean} [buildStale=false]
 */
export function getPostBuildLaunchPlan(mode, hasBuild, buildStale = false) {
  const { needsBuild, useProd } = getWebLaunchPlan(mode, hasBuild, false);
  return {
    needsBuild,
    useProd,
    staleAfterBuild: Boolean(hasBuild && buildStale),
  };
}

export function webRestartDelay(attempt) {
  const n = Number.isFinite(attempt) ? Math.max(1, Math.trunc(attempt)) : 1;
  return Math.min(1000 * n, 5000);
}

/**
 * Decide the next WebUI restart delay. Short backoff while under the burst
 * limit, then a long cool-down retry forever — never give up, because the
 * failure is often a transient rebuild failure and the tray host is the only
 * thing that can bring the WebUI back.
 *
 * @param {number} attempt 1-based restart attempt counter.
 * @param {number} [maxBurst=5] Number of fast retries before cool-down.
 * @returns {{ delayMs: number, coolingDown: boolean }}
 */
export function webRestartSchedule(attempt, maxBurst = 5) {
  const n =
    Number.isFinite(attempt) && attempt > 0 ? Math.trunc(attempt) : 1;
  const burst = Number.isFinite(maxBurst) && maxBurst > 0 ? Math.trunc(maxBurst) : 5;
  if (n <= burst) {
    return { delayMs: webRestartDelay(n), coolingDown: false };
  }
  // Past the burst budget: keep retrying at a calm 60s cadence forever.
  return { delayMs: 60_000, coolingDown: true };
}

/**
 * True when a production BUILD_ID exists but watched sources are newer.
 * Missing BUILD_ID is not "stale" — callers treat absence via hasBuild.
 *
 * @param {string} webDir
 * @param {{
 *   existsSync?: (path: string) => boolean,
 *   statSync?: (path: string) => { isDirectory(): boolean, isFile(): boolean, mtimeMs: number },
 *   readdirSync?: (path: string) => string[],
 * }} [fsApi]
 */
export function isWebBuildStale(webDir, fsApi = {}) {
  const existsSync = fsApi.existsSync ?? defaultExistsSync;
  const statSync = fsApi.statSync ?? defaultStatSync;
  const readdirSync = fsApi.readdirSync ?? defaultReaddirSync;

  const buildIdPath = join(webDir, '.next', 'BUILD_ID');
  if (!existsSync(buildIdPath)) return false;

  let buildMtimeMs;
  try {
    buildMtimeMs = statSync(buildIdPath).mtimeMs;
  } catch {
    return false;
  }

  for (const name of WATCHED_ROOT_FILES) {
    const path = join(webDir, name);
    if (!existsSync(path)) continue;
    try {
      if (statSync(path).mtimeMs > buildMtimeMs) return true;
    } catch {
      // Ignore transient stat races.
    }
  }

  for (const dirName of WATCHED_DIRS) {
    const root = join(webDir, dirName);
    if (!existsSync(root)) continue;
    if (hasNewerFile(root, buildMtimeMs, { existsSync, statSync, readdirSync })) {
      return true;
    }
  }

  for (const dirName of WATCHED_SIBLING_DIRS) {
    const root = join(webDir, '..', dirName);
    if (!existsSync(root)) continue;
    if (hasNewerFile(root, buildMtimeMs, { existsSync, statSync, readdirSync })) {
      return true;
    }
  }

  return false;
}

function hasNewerFile(dir, buildMtimeMs, fsApi) {
  let entries;
  try {
    entries = fsApi.readdirSync(dir);
  } catch {
    return false;
  }

  for (const name of entries) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const path = join(dir, name);
    let st;
    try {
      st = fsApi.statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (hasNewerFile(path, buildMtimeMs, fsApi)) return true;
      continue;
    }
    if (!st.isFile()) continue;
    const dot = name.lastIndexOf('.');
    if (dot < 0) continue;
    const ext = name.slice(dot).toLowerCase();
    if (!WATCHED_EXTENSIONS.has(ext)) continue;
    if (st.mtimeMs > buildMtimeMs) return true;
  }
  return false;
}
