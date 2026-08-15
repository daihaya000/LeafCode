/**
 * OpenCode CLI discovery and auto-update for the host process
 * (REFACTORING_PLAN P6-a / IMPROVEMENT 4-1: OpenCode start group).
 */
import { execFileSync, execSync, spawn } from 'child_process';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import {
  isWindowsPeExecutable,
  npmOpencodeSiblingExe,
  pickOpencodePath,
} from './opencode-path.js';
import { hardKillTree } from './process-stop.js';

export function repairNpmOpencodeStub(opencodePath, io = {}) {
  const exists = io.existsSync ?? existsSync;
  const isPe = io.isPe ?? ((p) => isWindowsPeExecutable(p, { existsSync: exists }));
  const runPostinstall =
    io.runPostinstall ??
    ((pkgDir) =>
      execFileSync(process.execPath, [join(pkgDir, 'postinstall.mjs')], {
        cwd: pkgDir,
        timeout: 120_000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }));
  const exe = /\.exe$/i.test(opencodePath)
    ? opencodePath
    : npmOpencodeSiblingExe(opencodePath);
  if (!exe || isPe(exe)) return null;
  const pkgDir = dirname(dirname(exe));
  if (!exists(join(pkgDir, 'postinstall.mjs'))) return null;
  try {
    runPostinstall(pkgDir);
    return isPe(exe) ? exe : null;
  } catch {
    return null;
  }
}

/**
 * Persisted "last upgrade check" state. Lets a host start skip the
 * `opencode upgrade` channel probe entirely when a recent start already
 * confirmed the CLI is current, instead of paying the spawn + network check
 * on every launch.
 * @param {string | null} stateFile
 * @param {{ readFileSync?: typeof readFileSync }} [io]
 * @returns {{ lastCheckAt: number } | null}
 */
export function readUpgradeState(stateFile, io = {}) {
  if (!stateFile) return null;
  const read = io.readFileSync ?? readFileSync;
  try {
    const value = JSON.parse(read(stateFile, 'utf8'));
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Number.isFinite(value.lastCheckAt)
    ) {
      return { lastCheckAt: value.lastCheckAt };
    }
  } catch {
    // Missing or corrupt — no state, so the next start runs a real check.
  }
  return null;
}

/**
 * Stamp the last successful upgrade check. Best-effort: a failed write only
 * means the next start re-checks.
 * @param {string | null} stateFile
 * @param {number} lastCheckAt
 * @param {{ mkdirSync?: typeof mkdirSync, writeFileSync?: typeof writeFileSync }} [io]
 */
export function writeUpgradeState(stateFile, lastCheckAt, io = {}) {
  if (!stateFile) return;
  const mkdir = io.mkdirSync ?? mkdirSync;
  const write = io.writeFileSync ?? writeFileSync;
  try {
    mkdir(dirname(stateFile), { recursive: true });
    write(stateFile, JSON.stringify({ lastCheckAt }), {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // best-effort
  }
}

/**
 * @param {{
 *   log?: (message: string) => void,
 *   error?: (message: string) => void,
 *   recordLog?: (source: string, level: string, text: string) => void,
 *   repoRoot?: string,
 *   stateFile?: string | null,
 *   cooldownMs?: number,
 *   now?: () => number,
 *   findOpencode?: () => string,
 *   runOpencodeUpgrade?: (opencodePath: string, timeoutMs?: number) => Promise<{ ok: boolean, message?: string, code?: number | null }>,
 * }} [deps]
 */
export function createOpencodeUpgrader(deps = {}) {
  const log = deps.log ?? (() => {});
  const error = deps.error ?? (() => {});
  const recordLog = deps.recordLog ?? (() => {});
  const repoRoot = deps.repoRoot ?? process.cwd();

  /** Auto-update OpenCode CLI once per host start, before `serve` spawns.
   *  Disable with LEAFCODE_AUTO_UPDATE_OPENCODE=0 (or =false). */
  const autoUpdate = !['0', 'false'].includes(
    String(process.env.LEAFCODE_AUTO_UPDATE_OPENCODE ?? '').toLowerCase(),
  );
  /** Bounded so a slow/unreachable update channel never blocks startup long. */
  const UPGRADE_TIMEOUT_MS = 180_000;
  /**
   * After a successful `opencode upgrade` check, skip the next starts' probes
   * for this long (default 24 h, tunable via
   * LEAFCODE_OPENCODE_UPGRADE_COOLDOWN_HOURS). The CLI is checked roughly once
   * a day instead of on every launch.
   */
  const cooldownHours = Number(
    process.env.LEAFCODE_OPENCODE_UPGRADE_COOLDOWN_HOURS ?? 24,
  );
  const cooldownMs =
    deps.cooldownMs ??
    (Number.isFinite(cooldownHours) && cooldownHours > 0
      ? cooldownHours * 3_600_000
      : 24 * 3_600_000);
  const now = deps.now ?? Date.now;
  const stateFile = deps.stateFile ?? null;

  const findOpencode = deps.findOpencode ?? (() => {
  /** @type {string[]} */
  let lines = [];
  try {
    const output = execSync('where.exe opencode', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    lines = output
      .trim()
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    // where.exe exits non-zero when nothing matches; still try WinGet Links.
  }

  const picked = pickOpencodePath(lines, {
    localAppData: process.env.LOCALAPPDATA,
  });
  if (picked) return picked;
  throw new Error('opencode not found on PATH. Install OpenCode CLI first.');
});


/**
 * Run `opencode upgrade` non-interactively (no TTY). Resolves without
 * throwing; the caller logs the outcome and continues with the existing
 * binary on any failure. Output is teed into the disk log / ring buffer like
 * the `serve` process, so the WebUI host log shows what happened.
 * @param {string} opencodePath
 * @param {number} [timeoutMs]
 * @returns {Promise<{ ok: boolean, message?: string, code?: number | null }>}
 */
  const runOpencodeUpgrade = (opencodePath, timeoutMs = UPGRADE_TIMEOUT_MS) => {
  return new Promise((resolve) => {
    const useShell = /\.(cmd|bat)$/i.test(opencodePath);
    const child = spawn(opencodePath, ['upgrade'], {
      cwd: repoRoot,
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env },
    });
    child.stdout?.on('data', (chunk) => {
      process.stdout.write(`[opencode-upgrade] ${chunk}`);
      recordLog('opencode', 'log', chunk.toString());
    });
    child.stderr?.on('data', (chunk) => {
      process.stderr.write(`[opencode-upgrade] ${chunk}`);
      recordLog('opencode', 'error', chunk.toString());
    });
    const timer = setTimeout(() => {
      log(
        `OpenCode CLI upgrade timed out after ${Math.round(timeoutMs / 1000)}s — continuing with the existing binary`,
      );
      try {
        hardKillTree(child.pid);
      } catch {
        /* already gone */
      }
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, message: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, code });
      else resolve({ ok: false, code, message: `exit code ${code}` });
    });
  });
}

/**
 * Repair an npm `opencode-ai` install whose postinstall was skipped (package
 * manager upgrades can ship with `--ignore-scripts`, leaving a shell stub
 * that Windows refuses to run — the same failure `opencode-path.js`
 * documents). Runs the package's own `postinstall.mjs`, which replaces the
 * stub with the real PE binary. Returns the repaired exe path, or null when
 * nothing needed fixing or the repair failed.
 * @param {string} opencodePath Resolved CLI path (shim or exe).
 * @param {{
 *   existsSync?: typeof existsSync,
 *   isPe?: (path: string) => boolean,
 *   runPostinstall?: (pkgDir: string) => void,
 * }} [io] Injectable IO for tests.
 * @returns {string | null}
 */

/**
 * Best-effort `opencode --version` for the resolved CLI. Returns null when
 * the path is a shell shim or the call fails (never throws).
 * @param {string} opencodePath
 * @returns {string | null}
 */
  const readOpencodeVersion = (opencodePath) => {
  if (!opencodePath || /\.(cmd|bat)$/i.test(opencodePath)) return null;
  try {
    return (
      execFileSync(opencodePath, ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15_000,
      }).trim() || null
    );
  } catch {
    return null;
  }
}

/**
 * Auto-update the OpenCode CLI before `serve` spawns. Skips the probe when a
 * recent start already confirmed the CLI current (see readUpgradeState);
 * otherwise runs `opencode upgrade` (a no-op when already current) and stamps
 * the state on success. Never throws: failures are logged and startup
 * continues with the existing binary. After a successful package-manager
 * upgrade, a skipped-postinstall stub is repaired so the freshly installed
 * binary is actually runnable.
 * @returns {Promise<{ upgraded: boolean, version: string | null, skipped?: boolean }>}
 */
  const upgradeOpencodeCli = async () => {
  if (!autoUpdate) {
    log(
      'OpenCode CLI auto-update is disabled (LEAFCODE_AUTO_UPDATE_OPENCODE=0)',
    );
    return { upgraded: false, version: null };
  }
  const state = readUpgradeState(stateFile);
  const checkedAt = now();
  if (state && checkedAt - state.lastCheckAt < cooldownMs) {
    const minutes = Math.max(1, Math.round((checkedAt - state.lastCheckAt) / 60_000));
    log(
      `OpenCode CLI auto-update skipped: last check was ${minutes} min ago (cooldown ${Math.round(cooldownMs / 3_600_000)} h)`,
    );
    return { upgraded: false, version: null, skipped: true };
  }
  let opencodePath;
  try {
    opencodePath = findOpencode();
  } catch (err) {
    error(
      `OpenCode CLI auto-update skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { upgraded: false, version: null };
  }
  log(`Upgrading OpenCode CLI: ${opencodePath} upgrade`);
  const runUpgrade = deps.runOpencodeUpgrade ?? runOpencodeUpgrade;
  const result = await runUpgrade(opencodePath);
  if (!result.ok) {
    error(
      `OpenCode CLI upgrade failed (${result.message ?? 'unknown'}) — continuing with the existing binary`,
    );
    // No state stamp: a failed channel probe retries on the next start.
    return { upgraded: false, version: null };
  }
  writeUpgradeState(stateFile, now());
  const repaired = repairNpmOpencodeStub(opencodePath);
  if (repaired) {
    log(
      `Repaired OpenCode npm install (postinstall stub replaced by real binary at ${repaired})`,
    );
  }
  const version = readOpencodeVersion(findOpencode());
  log(
    version
      ? `OpenCode CLI upgrade completed — now ${version}`
      : 'OpenCode CLI upgrade completed',
  );
  return { upgraded: true, version };
}
  return { findOpencode, upgradeOpencodeCli };
}
