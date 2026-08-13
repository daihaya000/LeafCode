// Startup preflight checks for scripts/start-webui.bat.
//
// The batch used to answer each question with a separate child process
// (PowerShell for the launcher freshness check, `opencode --version`,
// `caddy version`), which cost roughly 250-950 ms each. This module answers
// all of them from a single Node boot (~80 ms) with file-system checks only:
//
//   node scripts/preflight.mjs --launcher   exit 1 when the root exe is stale
//   node scripts/preflight.mjs --opencode   exit 0/1/2 (see locateOpencode)
//   node scripts/preflight.mjs --caddy      exit 0/1/2 (see locateCaddy)
//   node scripts/preflight.mjs              prints "launcher=.. opencode=.. caddy=.."
//
// Exit codes for --opencode / --caddy:
//   0 = a runnable binary was positively located
//   1 = not found anywhere (the batch falls back to installing it)
//   2 = only an npm-style shim (.cmd) is on PATH whose binary could not be
//       verified - the batch then runs `opencode --version` / `caddy
//       version` once to decide between "works" and "install".
//
// Running `--version` for every check would be the most reliable signal but
// is exactly what this module exists to avoid: a shim on PATH only matters
// when it is the *only* way the command is reachable, and npm shims only
// break when their postinstall was interrupted, so the slow verification is
// kept on that rare path.

import { existsSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  isWindowsPeExecutable,
  npmOpencodeSiblingExe,
  wingetLinkPath,
} from './lib/opencode-path.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Build inputs of the committed root launcher OpenCodeWebUI.exe. */
const LAUNCHER_INPUTS = [
  'scripts/launcher/Launcher.cs',
  'scripts/build-launcher.bat',
  'host/src/icon.json',
];

/**
 * True when the root launcher exe is missing or older than one of its build
 * inputs (mtime comparison, same semantics as the PowerShell check it
 * replaces). Pure so unit tests can pass an alternate repo root.
 * @param {string} [repoRoot]
 * @returns {boolean}
 */
export function launcherIsStale(repoRoot = REPO_ROOT) {
  const exe = join(repoRoot, 'OpenCodeWebUI.exe');
  try {
    if (!existsSync(exe)) return true;
    const exeTime = statSync(exe).mtimeMs;
    for (const input of LAUNCHER_INPUTS) {
      const inputPath = join(repoRoot, input);
      if (!existsSync(inputPath)) continue;
      if (statSync(inputPath).mtimeMs > exeTime) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * First existing file named `name` + PATHEXT extension across PATH, or null.
 * PATH entries are visited in order; within a directory the PATHEXT order is
 * used so real executables (.exe) win over shims (.cmd/.bat).
 * @param {string} name
 * @param {{ pathEnv?: string, pathext?: string }} [opts]
 * @returns {string | null}
 */
export function findOnPath(name, { pathEnv, pathext } = {}) {
  const dirs = (pathEnv ?? process.env.PATH ?? '').split(';').filter(Boolean);
  const exts = (pathext ?? process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, `${name}${ext}`);
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        // Unreadable/odd PATH entry - skip it.
      }
    }
  }
  return null;
}

/**
 * Locate a runnable opencode without executing it.
 * Returns { code, path }: code 0 = runnable found (real .exe on PATH, WinGet
 * Links exe, or an npm shim whose postinstall binary exists); 1 = not found;
 * 2 = only a .cmd/.bat shim is reachable and its binary could not be
 * verified (rare broken npm install).
 * @param {{ apdata?: string, localApdata?: string }} [opts]
 */
export function locateOpencode({ apdata, localApdata } = {}) {
  const appData = apdata ?? process.env.APPDATA;
  const localAppData = localApdata ?? process.env.LOCALAPPDATA;
  const found = findOnPath('opencode');
  if (found && /\.exe$/i.test(found) && isWindowsPeExecutable(found)) return { code: 0, path: found };
  const winget = wingetLinkPath('opencode', localAppData);
  if (winget && existsSync(winget)) return { code: 0, path: winget };
  const npmBinary = found ? npmOpencodeSiblingExe(found) : null;
  if (npmBinary && existsSync(npmBinary)) return { code: 0, path: npmBinary };
  if (found) return { code: 2, path: found };
  return { code: 1, path: null };
}

/**
 * Locate a runnable caddy without executing it. Same codes as
 * locateOpencode, minus the npm-shim path.
 * @param {{ localApdata?: string }} [opts]
 */
export function locateCaddy({ localApdata } = {}) {
  const localAppData = localApdata ?? process.env.LOCALAPPDATA;
  const found = findOnPath('caddy');
  if (found && /\.exe$/i.test(found)) return { code: 0, path: found };
  const winget = wingetLinkPath('caddy', localAppData);
  if (winget && existsSync(winget)) return { code: 0, path: winget };
  if (found) return { code: 2, path: found };
  return { code: 1, path: null };
}

const args = process.argv.slice(2);
if (args.includes('--launcher')) {
  process.exit(launcherIsStale() ? 1 : 0);
}
if (args.includes('--opencode')) {
  process.exit(locateOpencode().code);
}
if (args.includes('--caddy')) {
  process.exit(locateCaddy().code);
}
// No mode: one-line status snapshot for the batch (single node boot). Values:
// launcher 1 = rebuild needed; opencode/caddy use the locate* exit codes.
console.log(
  `launcher=${launcherIsStale() ? 1 : 0} opencode=${locateOpencode().code} caddy=${locateCaddy().code}`,
);
process.exit(0);
