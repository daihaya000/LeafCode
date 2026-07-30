/**
 * Disk-persisted host log with size-based rotation.
 *
 * The in-memory ring buffer (log-buffer.js) is volatile and easily overwritten
 * by a high-frequency source (e.g. Caddy error spam), so post-mortem analysis
 * of a WebUI crash is often impossible. This module appends every host log
 * line to `host.log` under DATA_DIR and rotates it when it grows past
 * `maxBytes`, keeping up to `maxFiles` generations. File writes must never
 * take the host down, so all fs errors are swallowed by the writer.
 *
 * Pure helpers (formatLogLine, shouldRotate, rotateFilePaths) are exported for
 * unit testing without touching the real filesystem.
 */

import {
  appendFileSync as defaultAppendFileSync,
  statSync as defaultStatSync,
  renameSync as defaultRenameSync,
  existsSync as defaultExistsSync,
  unlinkSync as defaultUnlinkSync,
} from 'fs';
import { join } from 'path';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_FILES = 3;
const LOG_FILENAME = 'host.log';

/**
 * Collapse internal newlines/tabs so one log entry is always one file line.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  const str = typeof text === 'string' ? text : String(text ?? '');
  return str.replace(/\r?\n/g, ' ').replace(/\t/g, ' ');
}

/**
 * Format a log entry as a single line (no trailing newline).
 * @param {{ ts: number, source: string, level: string, text: string }} entry
 * @returns {string}
 */
export function formatLogLine(entry) {
  const ts =
    entry && typeof entry.ts === 'number'
      ? new Date(entry.ts).toISOString()
      : new Date().toISOString();
  const source = entry?.source ?? 'host';
  const level = entry?.level ?? 'log';
  const text = normalizeText(entry?.text ?? '');
  return `${ts}\t${source}\t${level}\t${text}`;
}

/**
 * Pure rotation trigger: rotate once the current file size reaches/exceeds
 * the configured maximum.
 * @param {number} sizeBytes
 * @param {number} maxBytes
 * @returns {boolean}
 */
export function shouldRotate(sizeBytes, maxBytes) {
  return (
    Number.isFinite(sizeBytes) &&
    Number.isFinite(maxBytes) &&
    sizeBytes >= maxBytes
  );
}

/**
 * Build the rotation file path for a generation index.
 * Index 0 is the active log; index N is the Nth rotated copy.
 * @param {string} dir
 * @param {number} index
 * @returns {string}
 */
export function rotateFilePath(dir, index) {
  return index === 0
    ? join(dir, LOG_FILENAME)
    : join(dir, `${LOG_FILENAME}.${index}`);
}

/**
 * Pure helper: list the file paths involved in a rotation chain, oldest first.
 * Used by tests to assert the rename/delete plan without performing IO.
 *
 * @param {string} dir
 * @param {number} maxFiles
 * @returns {string[]} paths from oldest (to delete) to newest (active log)
 */
export function rotateFilePaths(dir, maxFiles) {
  const count = Math.max(1, Math.trunc(maxFiles));
  const paths = [];
  for (let i = count; i >= 0; i -= 1) paths.push(rotateFilePath(dir, i));
  return paths;
}

/**
 * Create a log file writer that appends entries to `host.log` and rotates
 * generations when the file grows past `maxBytes`. All fs failures are
 * swallowed so a broken disk never kills the tray host.
 *
 * @param {{
 *   dir: string,
 *   maxBytes?: number,
 *   maxFiles?: number,
 *   fs?: {
 *     appendFileSync?: (path: string, data: string) => void,
 *     statSync?: (path: string) => { size: number },
 *     renameSync?: (from: string, to: string) => void,
 *     existsSync?: (path: string) => boolean,
 *     unlinkSync?: (path: string) => void,
 *   },
 * }} options
 * @returns {{ write: (entry: { ts?: number, source?: string, level?: string, text?: string }) => void, writeRaw: (line: string) => void }}
 */
export function createLogFileWriter({
  dir,
  maxBytes = DEFAULT_MAX_BYTES,
  maxFiles = DEFAULT_MAX_FILES,
  fs = {},
} = {}) {
  const appendFileSync = fs.appendFileSync ?? defaultAppendFileSync;
  const statSync = fs.statSync ?? defaultStatSync;
  const renameSync = fs.renameSync ?? defaultRenameSync;
  const existsSync = fs.existsSync ?? defaultExistsSync;
  const unlinkSync = fs.unlinkSync ?? defaultUnlinkSync;

  const logPath = join(dir, LOG_FILENAME);
  const generations = Math.max(1, Math.trunc(maxFiles));

  function rotate() {
    // Shift host.log.N -> host.log.(N+1) from oldest to newest, then promote
    // the active log to .1. Any file beyond the kept generations is deleted.
    for (let i = generations; i >= 1; i -= 1) {
      const from = i === 1 ? logPath : rotateFilePath(dir, i - 1);
      const to = rotateFilePath(dir, i);
      try {
        if (!existsSync(from)) continue;
        if (i === generations && existsSync(to)) {
          // Overwrite the oldest kept slot before renaming into it.
          unlinkSync(to);
        }
        renameSync(from, to);
      } catch {
        // Best-effort rotation; a stuck rename must not block logging.
      }
    }
  }

  function writeRaw(line) {
    try {
      let size = 0;
      try {
        size = statSync(logPath).size;
      } catch {
        // File may not exist yet — treat as 0.
        size = 0;
      }
      if (shouldRotate(size, maxBytes)) rotate();
      appendFileSync(logPath, `${line}\n`);
    } catch {
      // Never let a disk error take the host down.
    }
  }

  function write(entry) {
    writeRaw(formatLogLine(entry));
  }

  return { write, writeRaw };
}