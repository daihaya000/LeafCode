// Dependency-freshness check for scripts/start-webui.bat.
//
// The batch used `npm --prefix <dir> ls --depth=0` to decide whether
// `npm ci` was needed. On this project's machines that one command costs
// 1.3-16 s per project (it walks the whole dependency tree), and it is run
// three times on every launch even when nothing changed. This module instead
// hashes `package-lock.json` once (a few ms) and compares it with a stamp
// written after the last `npm ci`:
//
//   node scripts/check-deps.mjs <dir>...      exit 1 when any needs `npm ci`
//   node scripts/check-deps.mjs --update <dir>...  stamp as freshly installed
//
// The stamp lives inside node_modules (`.deps-stamp`), so it is never
// committed and survives between launches. Content hashing is required:
// mtime comparisons misfire here because git checkouts and OneDrive sync
// rewrite timestamps without changing the lockfile (and vice versa).
//
// Trade-off vs `npm ls`: a *modified* node_modules tree (someone deleted a
// package) is no longer detected. That is accepted for startup speed; a
// changed lockfile - the actual cause of stale trees - still triggers the
// reinstall.

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const STAMP_NAME = '.deps-stamp';

export function lockfilePath(dir) {
  return join(dir, 'package-lock.json');
}

/** sha256 hex of the project's package-lock.json, or null when absent. */
export function lockfileHash(dir) {
  const lock = lockfilePath(dir);
  if (!existsSync(lock)) return null;
  return createHash('sha256').update(readFileSync(lock)).digest('hex');
}

function stampFile(dir) {
  return join(dir, 'node_modules', STAMP_NAME);
}

function readStamp(dir) {
  try {
    return readFileSync(stampFile(dir), 'utf8').trim();
  } catch {
    return null;
  }
}

/** Write the current lockfile hash as the verified-install stamp. */
export function writeStamp(dir) {
  const hash = lockfileHash(dir);
  if (!hash) return;
  const target = stampFile(dir);
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, hash, 'utf8');
  } catch {
    // Best effort: a missing stamp only means the next run re-verifies.
  }
}

/**
 * True when the project needs `npm ci`: node_modules is missing, the
 * lockfile changed since the last verified install, or there is no lockfile.
 * A node_modules tree with no stamp yet (installed by an older version of
 * this script) is treated as fresh and stamped in place.
 */
export function needsInstall(dir) {
  if (!existsSync(join(dir, 'node_modules'))) return true;
  const hash = lockfileHash(dir);
  if (!hash) return true;
  const previous = readStamp(dir);
  if (previous === null) {
    writeStamp(dir);
    return false;
  }
  return previous !== hash;
}

const args = process.argv.slice(2);
const update = args.includes('--update');
const dirs = args.filter((arg) => !arg.startsWith('--'));
if (dirs.length === 0) process.exit(2);
let exitCode = 0;
for (const dir of dirs) {
  if (update) {
    writeStamp(dir);
    continue;
  }
  if (needsInstall(dir)) exitCode = 1;
}
process.exit(exitCode);
