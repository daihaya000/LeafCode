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

export function webRestartDelay(attempt) {
  const n = Number.isFinite(attempt) ? Math.max(1, Math.trunc(attempt)) : 1;
  return Math.min(1000 * n, 5000);
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
