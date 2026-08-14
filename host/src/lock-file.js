/**
 * Single-instance lock file helpers (REFACTORING_PLAN P6-a / IMPROVEMENT 4-1).
 * Lock file format: JSON `{ pid, created }` where `created` is the host
 * process creation time (FILETIME). Legacy format was a bare PID string.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Lock file format: JSON `{ pid, created }` where `created` is the host
 * process creation time (FILETIME). Legacy format was a bare PID string;
 * it is still readable (`created` will be null).
 */
export function readLock(lockFile) {
  if (!existsSync(lockFile)) return null;
  try {
    const raw = readFileSync(lockFile, 'utf8').trim();
    if (raw.startsWith('{')) {
      const data = JSON.parse(raw);
      const pid = Number.parseInt(String(data.pid), 10);
      if (!Number.isFinite(pid)) return null;
      return { pid, created: typeof data.created === 'string' ? data.created : null };
    }
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) ? { pid, created: null } : null;
  } catch {
    return null;
  }
}

export function readLockPid(lockFile) {
  return readLock(lockFile)?.pid ?? null;
}

/**
 * Claim the single-instance lock.
 *
 * The Win32_Process CreationDate query costs ~850 ms (PowerShell + CIM boot)
 * and used to sit on the critical startup path for no reason: the exclusive
 * 'wx' write is what enforces single-instance, while `created` only guards
 * against PID reuse observed by a *later* instance. So take the lock now and
 * backfill the field in the background. `createdPending` marks a new-format
 * lock whose creation time is still being resolved, so a competing instance
 * keeps using the strict command-line check rather than the looser heuristic
 * reserved for genuinely legacy locks.
 */
export function writeLock(lockFile) {
  writeFileSync(
    lockFile,
    JSON.stringify({ pid: process.pid, created: null, createdPending: true }),
    { encoding: 'utf8', flag: 'wx' },
  );
  backfillLockCreationTime(lockFile);
}

export function backfillLockCreationTime(lockFile) {
  execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter 'ProcessId=${process.pid}').CreationDate.ToFileTime()`,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 8000 },
  )
    .then(({ stdout }) => {
      const created = String(stdout).trim();
      if (!/^\d+$/.test(created)) return;
      // readLock() returns null once removeLock() ran, so a shutdown that beat
      // the query can never resurrect the lock file here.
      if (readLock(lockFile)?.pid !== process.pid) return;
      writeFileSync(
        lockFile,
        JSON.stringify({ pid: process.pid, created }),
        'utf8',
      );
    })
    .catch(() => {
      // Leave the pending lock as is; identity checks fall back to the
      // command line, exactly as they do when CIM is unavailable.
    });
}

export function removeLock(lockFile, deps = {}) {
  if (!existsSync(lockFile)) return;
  try {
    const lockPid = readLockPid(lockFile);
    if (lockPid === process.pid) {
      unlinkSync(lockFile);
      deps.removeControlFile?.();
    }
  } catch {
    // best effort
  }
}
