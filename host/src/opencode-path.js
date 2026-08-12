/**
 * Resolve a runnable OpenCode CLI path on Windows.
 *
 * npm's `opencode-ai` package ships `bin/opencode.exe` as a shell stub until
 * `postinstall.mjs` replaces it with the real PE binary. When that step is
 * skipped (`--ignore-scripts`, pnpm defaults, interrupted install), `where
 * opencode` still finds the stub ahead of a working WinGet install and
 * Windows refuses to start it (Wow64 / "not a valid Win32 application").
 */

import { closeSync, existsSync, openSync, readSync } from 'fs';
import { dirname, join } from 'path';

/**
 * True when `filePath` looks like a Windows PE executable (MZ header).
 * Only the first two bytes are read so multi‑hundred‑MB CLI binaries stay cheap.
 * @param {string} filePath
 * @param {{
 *   existsSync?: typeof existsSync,
 *   readHeader?: (path: string) => Uint8Array,
 * }} [io]
 * @returns {boolean}
 */
export function isWindowsPeExecutable(filePath, io = {}) {
  const exists = io.existsSync ?? existsSync;
  const readHeader =
    io.readHeader ??
    ((path) => {
      const fd = openSync(path, 'r');
      try {
        const buf = Buffer.alloc(2);
        const n = readSync(fd, buf, 0, 2, 0);
        return buf.subarray(0, n);
      } finally {
        closeSync(fd);
      }
    });
  try {
    if (!exists(filePath)) return false;
    const header = readHeader(filePath);
    return header.length >= 2 && header[0] === 0x4d && header[1] === 0x5a;
  } catch {
    return false;
  }
}

/**
 * npm global layout: `<prefix>/opencode.cmd` → `<prefix>/node_modules/opencode-ai/bin/opencode.exe`
 * @param {string} shimPath
 * @returns {string}
 */
export function npmOpencodeSiblingExe(shimPath) {
  return join(dirname(shimPath), 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
}

/**
 * WinGet Links shim path for SST.opencode.
 * @param {string | undefined} localAppData
 * @returns {string | null}
 */
export function wingetOpencodeLink(localAppData) {
  if (!localAppData) return null;
  return join(localAppData, 'Microsoft', 'WinGet', 'Links', 'opencode.exe');
}

/**
 * Pick the best OpenCode binary from `where.exe opencode` lines + WinGet fallback.
 * Prefer a real PE `.exe`; never return the postinstall shell stub.
 *
 * @param {string[]} whereLines
 * @param {{
 *   localAppData?: string,
 *   existsSync?: typeof existsSync,
 *   isPe?: (path: string) => boolean,
 * }} [opts]
 * @returns {string | null}
 */
export function pickOpencodePath(whereLines, opts = {}) {
  const exists = opts.existsSync ?? existsSync;
  const isPe = opts.isPe ?? ((p) => isWindowsPeExecutable(p, { existsSync: exists }));
  const lines = whereLines.map((l) => l.trim()).filter(Boolean);

  for (const p of lines) {
    if (/\.exe$/i.test(p) && isPe(p)) return p;
  }

  for (const p of lines) {
    if (!/\.cmd$/i.test(p) && !/(^|[\\/])opencode$/i.test(p)) continue;
    const sibling = npmOpencodeSiblingExe(p);
    if (isPe(sibling)) return sibling;
  }

  const winget = wingetOpencodeLink(opts.localAppData);
  if (winget && isPe(winget)) return winget;

  // Last resort: a .cmd shim (may still fail if its sibling is a stub).
  const cmd = lines.find((p) => /\.cmd$/i.test(p));
  if (cmd) return cmd;

  return lines[0] || null;
}
