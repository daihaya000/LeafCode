import { spawn, execFile, execFileSync, execSync } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  unlinkSync,
} from 'fs';
import { randomBytes } from 'crypto';
import { networkInterfaces } from 'os';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import SysTrayImport from 'systray2';
import { WebSocketServer } from 'ws';
import { createBrowserBridgeBroker } from '../../browser-bridge/broker/server.mjs';
import { formatServiceStatus } from './service-status.js';
import {
  getWebLaunchPlan,
  getPostBuildLaunchPlan,
  isWebBuildStale,
  decideWebReuseOnStale,
  webRestartDelay,
  webRestartSchedule,
  webHealthDecision,
  pullLatestGitSource,
} from './web-runtime.js';
import { parseListeningPids } from './port-plan.js';
import { readPort } from './port-config.js';
import { isPlaceholderHost, syncCaddySiteAddresses } from './caddy-sites.js';
import {
  closeControlServer,
  createControlServer,
  listenControlServer,
} from './control-server.js';
import { resolveKillPids, resolveWebKillPids } from './restart-targets.js';
import { getLogEntries, pushLogEntry } from './log-buffer.js';
import { createLogFileWriter } from './log-file.js';
import {
  disposeOpencodeServer,
  hardKillTree,
  listChildPids,
  reapInheritedHolders,
  softKillTree,
  stopProcessTreeGracefully,
  stopWebTreeSync,
} from './process-stop.js';
// Reuse the build guard's listener identification so the stop path and the
// build guard agree on what counts as "our" production WebUI (never kill an
// unrelated app that happens to occupy the port). Import-safe: the guard only
// runs main() when executed directly.
import { isThisWebUiNextStart } from '../../scripts/production-webui-build-guard.mjs';
import { mirrorDistDir, mirrorWebDir, resolveMirrorRoot } from '../../scripts/web-build-mirror.mjs';
import {
  deleteUser,
  hasUsers,
  isAdmin,
  listUsers,
  upsertUser,
  verifyUser,
} from './auth-store.js';
import { readAuthConfig, writeAuthConfig } from './auth-config.js';
import { createTrustedDeviceStore } from './trusted-device-store.js';
import { readBrowserConfig, writeBrowserConfig } from './browser-config.js';
import {
  createLoginThrottle,
  createThrottleStore,
  verifyWindowsCredentials,
} from './windows-auth.js';
import {
  isWindowsPeExecutable,
  npmOpencodeSiblingExe,
  pickOpencodePath,
} from './opencode-path.js';

// systray2 CJS interop: default.default is the constructor under Node ESM
const SysTray =
  SysTrayImport?.default?.default ||
  SysTrayImport?.default ||
  SysTrayImport;
if (typeof SysTray !== 'function') {
  throw new Error(
    `systray2 import failed (got ${typeof SysTrayImport}). Reinstall host deps: cd host && npm install`,
  );
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST_DIR = join(__dirname, '..');
const REPO_ROOT = join(HOST_DIR, '..');
const WEB_DIR = join(REPO_ROOT, 'web');
const DATA_DIR = join(process.env.APPDATA, 'opencode-webui');
/**
 * Production builds and `next start` both run in the hard-link mirror outside
 * the OneDrive-synced tree (scripts/web-build-mirror.mjs), so the served files
 * are never touched by the sync client and Turbopack gets a distDir inside its
 * own project. Everything below points at the mirror, not at WEB_DIR.
 */
const WEB_MIRROR_ROOT = resolveMirrorRoot(process.env, REPO_ROOT);
const WEB_MIRROR_DIR = mirrorWebDir(WEB_MIRROR_ROOT);
const WEB_DIST_DIR = mirrorDistDir(WEB_MIRROR_ROOT);
/** Host package version, read from host/package.json for the log header. */
const HOST_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(HOST_DIR, 'package.json'), 'utf8'));
    return typeof pkg?.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
})();
const LOCK_FILE = join(DATA_DIR, 'host.lock');
const CONTROL_FILE = join(DATA_DIR, 'host-control.json');
const BROWSER_BRIDGE_PAIRING_FILE = join(DATA_DIR, 'browser-bridge-pairing.json');
/** Preferred OpenCode serve port. Override with OPENCODE_PORT. May bump on ghost sockets. */
let OPENCODE_PORT = readPort(process.env.OPENCODE_PORT, 4096);
let WEBUI_PORT = readPort(process.env.OPENCODE_WEBUI_PORT, 3000);
/** Localhost control plane for WebUI / tray restart actions. */
const CONTROL_PORT = readPort(process.env.OPENCODE_WEBUI_HOST_CONTROL_PORT, 18765);
let CONTROL_URL = `http://127.0.0.1:${CONTROL_PORT}`;
/** Secret for signing host-issued WebUI session cookies. Generated once per host run. */
const CONTROL_SECRET = randomBytes(32).toString('base64url');
/** Local-only Browser Bridge Broker. This port is never exposed through Caddy. */
const BROWSER_BRIDGE_PORT = readPort(process.env.OPENCODE_WEBUI_BROWSER_BROKER_PORT, 18766);

/** True when the host should run without a tray icon. */
export function isHeadless() {
  return (
    process.env.OPENCODE_HEADLESS === '1' ||
    process.env.OPENCODE_WEBUI_HEADLESS === '1' ||
    process.argv.includes('--headless')
  );
}

/** Bind address for Next.js. Default 127.0.0.1 (loopback only) so the WebUI
 *  is not exposed to the LAN/VPN without an explicit opt-in. OpenCode engine
 *  also stays on 127.0.0.1. To allow phone/LAN access, either enable the
 *  Caddy reverse proxy (OPENCODE_WEBUI_CADDY=1, recommended) or set
 *  OPENCODE_WEBUI_HOST=0.0.0.0 to bind every interface. */
const WEBUI_HOST = process.env.OPENCODE_WEBUI_HOST || '127.0.0.1';
let WEBUI_URL = `http://127.0.0.1:${WEBUI_PORT}`;
let OPENCODE_URL = `http://127.0.0.1:${OPENCODE_PORT}`;

function setOpencodePort(port) {
  OPENCODE_PORT = port;
  OPENCODE_URL = `http://127.0.0.1:${OPENCODE_PORT}`;
}

function setWebuiPort(port) {
  WEBUI_PORT = port;
  WEBUI_URL = `http://127.0.0.1:${WEBUI_PORT}`;
}

/** Optional Caddy reverse proxy (TLS / remote). Enable with OPENCODE_WEBUI_CADDY=1.
 *  Caddyfile path defaults to deploy/Caddyfile (auto-created from the example). */
const CADDY_ENABLED = process.env.OPENCODE_WEBUI_CADDY === '1';
const CADDYFILE =
  process.env.OPENCODE_WEBUI_CADDYFILE || join(REPO_ROOT, 'deploy', 'Caddyfile');
const CADDYFILE_EXAMPLE = join(REPO_ROOT, 'deploy', 'Caddyfile.example');

const CADDY_LOOPBACK_URL_RE = /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i;

/**
 * Collect HTTPS site origins from a Caddyfile (top-level site blocks only).
 * @param {string} text
 * @returns {string[]}
 */
export function parseCaddySiteUrls(text) {
  if (typeof text !== 'string') return [];
  const candidates = [];
  let depth = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    // Only site-address lines at top level (depth 0) that open a block.
    if (depth === 0 && line.endsWith('{')) {
      const head = line.slice(0, -1).trim();
      // Skip the global options block `{ ... }` (empty head).
      if (head) {
        for (const token of head.split(',')) {
          const addr = token.trim();
          if (!addr) continue;
          const https = /^https:\/\/([^\s{]+)/i.exec(addr);
          if (https) {
            const host = https[1].split(':')[0];
            if (isPlaceholderHost(host)) continue;
            candidates.push(`https://${https[1]}`);
            continue;
          }
          // Skip explicit http:// and port-only listeners (e.g. `:8080`).
          if (/^http:\/\//i.test(addr) || addr.startsWith(':')) continue;
          // A bare hostname (optionally :443) means Caddy auto-HTTPS.
          const bare = /^([a-z0-9.-]+)(?::(\d+))?$/i.exec(addr);
          if (bare && (!bare[2] || bare[2] === '443')) {
            candidates.push(`https://${bare[1]}${bare[2] ? `:${bare[2]}` : ''}`);
          }
        }
      }
    }
    // Track brace depth so nested directive blocks aren't treated as sites.
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
  }
  return candidates;
}

/**
 * Extract the public HTTPS origin from Caddyfile text (pure, testable).
 *
 * A LAN/VPN address is preferred over localhost so phones get a reachable URL
 * (used by /api/access). Returns null when no HTTPS site address is found.
 */
export function parseCaddyPublicUrl(text) {
  const candidates = parseCaddySiteUrls(text);
  if (candidates.length === 0) return null;
  const routable = candidates.find((u) => !CADDY_LOOPBACK_URL_RE.test(u));
  return routable || candidates[0];
}

/**
 * Loopback HTTPS origin from the Caddyfile for opening the browser on the host.
 * Prefer 127.0.0.1, then localhost / [::1]. Returns null when none are listed.
 */
export function parseCaddyLoopbackUrl(text) {
  const candidates = parseCaddySiteUrls(text);
  const preferred = candidates.find((u) => /\/\/127\.0\.0\.1(:|$)/i.test(u));
  if (preferred) return preferred;
  return candidates.find((u) => CADDY_LOOPBACK_URL_RE.test(u)) || null;
}

/**
 * Best-effort read of the public HTTPS origin from the active Caddyfile so the
 * WebUI's /api/access can advertise it instead of the internal http://IP:3000.
 * Returns null when Caddy is disabled or the file cannot be read/parsed.
 */
function detectCaddyPublicUrl() {
  if (!CADDY_ENABLED) return null;
  try {
    return parseCaddyPublicUrl(readFileSync(CADDYFILE, 'utf8'));
  } catch {
    return null;
  }
}

function detectCaddyLoopbackUrl() {
  if (!CADDY_ENABLED) return null;
  try {
    return parseCaddyLoopbackUrl(readFileSync(CADDYFILE, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Pure decision for {@link resolveBrowserUrl}: prefer a loopback Caddy HTTPS
 * origin for the host browser (so host-only APIs keep working), then the
 * public Caddy URL, otherwise the local WebUI URL.
 */
export function pickBrowserUrl({ caddyLocalUrl, caddyUrl, webuiUrl, caddyUp }) {
  if (caddyUp) {
    if (caddyLocalUrl) return caddyLocalUrl;
    if (caddyUrl) return caddyUrl;
  }
  return webuiUrl;
}

/**
 * Decide which URL to open in the browser on startup. Prefers loopback Caddy
 * HTTPS so folder picker / voice / restart stay reachable; LAN URL remains in
 * /api/access for phones. Falls back to http://127.0.0.1:WEBUI_PORT.
 */
async function resolveBrowserUrl() {
  const caddyLocalUrl = detectCaddyLoopbackUrl();
  const caddyUrl = detectCaddyPublicUrl();
  const probeUrl = caddyLocalUrl || caddyUrl;
  // Caddy can still be finishing TLS / listener startup when the WebUI is
  // already ready. Give it a short grace period so startup opens the intended
  // HTTPS proxy URL instead of racing and falling back to http://127.0.0.1:3000.
  const caddyUp = probeUrl ? await waitForHttpUp(probeUrl, 12, 500) : false;
  return pickBrowserUrl({
    caddyLocalUrl,
    caddyUrl,
    webuiUrl: WEBUI_URL,
    caddyUp,
  });
}

/**
 * Start resolving the startup URL without blocking. resolveBrowserUrl() waits
 * up to 6 s for Caddy's TLS listener, which is unrelated to WebUI / OpenCode
 * readiness, so it runs alongside those waits instead of after them.
 * @returns {Promise<string> | null} null when no browser should be opened.
 */
function startResolvingBrowserUrl() {
  if (!shouldOpenBrowser()) return null;
  return resolveBrowserUrl().catch(() => WEBUI_URL);
}

const iconData = JSON.parse(readFileSync(join(__dirname, 'icon.json'), 'utf8'));
const TRAY_ICON = iconData.base64;

/** @type {import('child_process').ChildProcess | null} */
let opencodeProc = null;
/** OpenCode auto-restart budget: max 3 restarts per 5 minutes. */
const MAX_OPENCODE_RESTARTS = 3;
const OPENCODE_RESTART_WINDOW_MS = 5 * 60 * 1000;
let opencodeRestartTimestamps = [];

export function resetOpencodeRestartBudget() {
  opencodeRestartTimestamps = [];
}

export function shouldRestartOpencode(now = Date.now()) {
  opencodeRestartTimestamps = opencodeRestartTimestamps.filter(
    (timestamp) => now - timestamp < OPENCODE_RESTART_WINDOW_MS,
  );
  if (opencodeRestartTimestamps.length >= MAX_OPENCODE_RESTARTS) {
    return false;
  }
  opencodeRestartTimestamps.push(now);
  return true;
}

/** Caddy auto-restart budget: max 3 restarts per 5 minutes (same as OpenCode). */
const MAX_CADDY_RESTARTS = 3;
const CADDY_RESTART_WINDOW_MS = 5 * 60 * 1000;
let caddyRestartTimestamps = [];

export function resetCaddyRestartBudget() {
  caddyRestartTimestamps = [];
}

export function shouldRestartCaddy(now = Date.now()) {
  caddyRestartTimestamps = caddyRestartTimestamps.filter(
    (timestamp) => now - timestamp < CADDY_RESTART_WINDOW_MS,
  );
  if (caddyRestartTimestamps.length >= MAX_CADDY_RESTARTS) {
    return false;
  }
  caddyRestartTimestamps.push(now);
  return true;
}

/** Decide how an OpenCode exit should be handled without performing side effects. */
export function getOpencodeExitDecision({
  quitting: isQuitting,
  exitedPid,
  currentPid,
  isPlannedExit,
  restartBudgetAvailable,
}) {
  const wasCurrent = exitedPid === currentPid;
  if (isQuitting || !exitedPid || isPlannedExit || !wasCurrent) {
    return {
      shouldReapPortHolders: false,
      shouldAutoRestart: false,
      logMessages: [],
    };
  }
  if (!restartBudgetAvailable) {
    return {
      shouldReapPortHolders: true,
      shouldAutoRestart: false,
      logMessages: [
        {
          level: 'error',
          message:
            'OpenCode restart budget exhausted (3/5min) — manual host restart required',
        },
      ],
    };
  }
  return {
    shouldReapPortHolders: true,
    shouldAutoRestart: true,
    logMessages: [
      { level: 'log', message: 'OpenCode crashed — attempting auto-restart…' },
    ],
  };
}

/** @type {import('child_process').ChildProcess | null} */
let webProc = null;
/** @type {import('child_process').ChildProcess | null} */
let webBuildProc = null;
/** In-flight production build promise, shared by concurrent callers to avoid
 * a second build tearing down the first one's in-progress `.next` output. */
let webBuildPromise = null;
/** @type {import('child_process').ChildProcess | null} */
let caddyProc = null;
/** @type {import('systray2').default | null} */
let systray = null;
/** @type {import('http').Server | null} */
let controlServer = null;
let browserBridgeBroker = null;
let quitting = false;
let restartingServices = false;

/** WebUI self-healing. Expected exits (manual restart/quit) never consume it. */
const MAX_WEB_RESTARTS = 5;
let webRestarts = 0;
/** True once we have logged the transition into the 60s cool-down retry loop,
 *  so the message is emitted only on the burst->cool-down boundary. */
let webCoolDownAnnounced = false;
/** @type {NodeJS.Timeout | null} */
let webRestartTimer = null;
/** @type {NodeJS.Timeout | null} */
let webStableTimer = null;
/** @type {NodeJS.Timeout | null} */
let webWatchdogTimer = null;
let webHealthFailures = 0;
let webStartedAt = 0;
let webHealthCheckInFlight = false;
const WEB_WATCHDOG_INTERVAL_MS = 10_000;
const WEB_WATCHDOG_FAILURE_LIMIT = 3;
const WEB_WATCHDOG_STARTUP_GRACE_MS = 60_000;
const expectedWebExitPids = new Set();
const expectedOpencodeExitPids = new Set();

function browserBridgeEnvironment() {
  if (!browserBridgeBroker) return {};
  return {
    OPENCODE_WEBUI_BROWSER_BROKER: browserBridgeBroker.url,
    OPENCODE_WEBUI_BROWSER_BROKER_TOKEN: browserBridgeBroker.internalToken,
  };
}

function loadBrowserBridgePairing() {
  if (!existsSync(BROWSER_BRIDGE_PAIRING_FILE)) return null;
  try {
    const value = JSON.parse(readFileSync(BROWSER_BRIDGE_PAIRING_FILE, 'utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)
      && typeof value.origin === 'string' && /^chrome-extension:\/\/[a-z]{16,64}$/.test(value.origin)
      && typeof value.deviceKey === 'string' && /^[A-Za-z0-9_-]{20,}$/.test(value.deviceKey)) {
      return { origin: value.origin, deviceKey: value.deviceKey };
    }
  } catch {}
  try { unlinkSync(BROWSER_BRIDGE_PAIRING_FILE); } catch {}
  return null;
}

function saveBrowserBridgePairing(value) {
  ensureDataDir();
  if (!value) {
    try { unlinkSync(BROWSER_BRIDGE_PAIRING_FILE); } catch {}
    return;
  }
  writeFileSync(BROWSER_BRIDGE_PAIRING_FILE, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
}

/** @type {string | null} */
let cachedNpmCli = null;

/** Tray self-healing: recreate the icon if the helper process dies unexpectedly. */
const MAX_TRAY_RESTARTS = 5;
let trayRestarts = 0;
/** @type {NodeJS.Timeout | null} */
let trayStableTimer = null;

const statusOpencodeItem = {
  title: 'OpenCode: …',
  tooltip: 'OpenCode serve status',
  checked: false,
  enabled: false,
};

const statusWebuiItem = {
  title: 'WebUI: …',
  tooltip: 'Next.js WebUI status',
  checked: false,
  enabled: false,
};

const statusCaddyItem = {
  title: 'Caddy: …',
  tooltip: 'Caddy reverse proxy status',
  checked: false,
  enabled: false,
};

/**
 * Disk-persisted log writer (host.log under DATA_DIR, rotated). Lazily created
 * on first use so unit tests that import this module never touch the disk.
 * All write failures are swallowed inside the writer — it can never take the
 * host down. See host/src/log-file.js.
 */
let logFileWriter = null;

function getLogFileWriter() {
  if (logFileWriter) return logFileWriter;
  try {
    logFileWriter = createLogFileWriter({ dir: DATA_DIR });
  } catch {
    logFileWriter = null;
  }
  return logFileWriter;
}

/**
 * Write a one-line header to the disk log at startup so each run is
 * identifiable later (host version / PID / start time / mode). Uses writeRaw
 * so the header is not duplicated into the in-memory ring buffer.
 */
function writeLogFileHeader() {
  const writer = getLogFileWriter();
  if (!writer) return;
  const mode =
    process.env.OPENCODE_WEBUI_MODE ||
    (process.env.NODE_ENV === 'production' ? 'prod' : 'auto');
  const header = `=== opencode-webui-host start version=${HOST_VERSION} pid=${process.pid} mode=${mode} ts=${new Date().toISOString()} ===`;
  writer.writeRaw(header);
}

/**
 * Tee a log entry into both the in-memory ring buffer and the disk log file.
 * Every pushLogEntry call site in this module goes through here so the disk
 * log stays in sync with the buffer without duplicating the console output.
 * @param {import('./log-buffer.js').LogSource} source
 * @param {import('./log-buffer.js').LogLevel} level
 * @param {string} text
 */
function recordLog(source, level, text) {
  const entry = pushLogEntry(source, level, text);
  const writer = getLogFileWriter();
  if (writer) writer.write(entry);
}

function log(message) {
  console.log(`[opencode-webui-host] ${message}`);
  recordLog('host', 'log', message);
}

function error(message) {
  console.error(`[opencode-webui-host] ${message}`);
  recordLog('host', 'error', message);
}

function isProcessAlive(pid) {
  try {
    const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.includes(String(pid));
  } catch {
    return false;
  }
}

/** Run Windows PowerShell without routing the command through cmd.exe quoting.
 *  Bounded by a timeout so a degraded CIM/WMI never hangs the caller — this is
 *  also invoked from the synchronous 'exit' handler, which must not block. */
function runPowerShell(command) {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 8000,
    },
  ).trim();
}

/** Command line of a PID, or null. Used to verify a lock PID is really our host (PID reuse). */
function getProcessCommandLine(pid) {
  try {
    const output = runPowerShell(
      `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`,
    ).trim();
    return output || null;
  } catch {
    return null;
  }
}

/** Process creation time (Windows FILETIME as string), or null. */
function getProcessCreationTime(pid) {
  try {
    const output = runPowerShell(
      `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CreationDate.ToFileTime()`,
    ).trim();
    return /^\d+$/.test(output) ? output : null;
  } catch {
    return null;
  }
}

/**
 * Whether the PID has a live systray helper child (tray_windows*.exe).
 * `null` means the CIM query failed; that is not proof that the tray is absent.
 */
function hasTrayChild(pid) {
  try {
    const output = runPowerShell(
      `@(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${Number(pid)}' | Where-Object { $_.Name -like 'tray_windows*' }).Count`,
    ).trim();
    return Number.parseInt(output, 10) > 0;
  } catch {
    return null;
  }
}

function looksLikeHostCommandLine(commandLine) {
  return (
    /node(\.exe)?"?\s/i.test(commandLine) &&
    /src[\\/]index\.js/i.test(commandLine)
  );
}

/**
 * Stricter identity check used when CreationDate is unavailable. Requires the
 * command line to reference the host directory or product name, not just any
 * node process running src/index.js (which could match unrelated apps).
 */
export function stronglyLooksLikeHostCommandLine(commandLine) {
  return (
    looksLikeHostCommandLine(commandLine) &&
    (/host[\\/]/i.test(commandLine) || /opencode-webui/i.test(commandLine))
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One `netstat -ano` run (~150 ms) dumps the whole TCP table, so several port
 * probes taken at the same instant can share it. Returns null when netstat
 * fails; callers then fall back to their own (also failing) lookup and treat
 * the port as free, which is the pre-existing behaviour.
 * @returns {{ output: string } | null}
 */
function captureNetstat() {
  const output = runNetstat();
  return output == null ? null : { output };
}

/**
 * Same snapshot, taken without blocking the event loop, so it can overlap with
 * an unrelated await (see startChildren: the git pull runs concurrently).
 * @returns {Promise<{ output: string } | null>}
 */
async function captureNetstatAsync() {
  try {
    const { stdout } = await execFileAsync('netstat.exe', ['-ano'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { output: String(stdout) };
  } catch {
    return null;
  }
}

function runNetstat() {
  try {
    return execSync('netstat -ano', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      // Bounded so a degraded network stack cannot hang the caller (this is
      // also used from the synchronous 'exit' handler).
      timeout: 5000,
    });
  } catch {
    return null;
  }
}

/**
 * @param {number} port
 * @param {{ output: string } | null} [snapshot] Point-in-time netstat output.
 *   Only pass one when no process has been started or killed since it was
 *   taken — anything that waits for a port to change state must re-run netstat.
 */
function getListeningPids(port, snapshot) {
  const output = snapshot?.output ?? runNetstat();
  if (output == null) return [];
  try {
    return parseListeningPids(output, port);
  } catch {
    return [];
  }
}

/**
 * Parse the JSON emitted by the batched Win32_Process query into a
 * `pid -> commandLine` map. Defensive: any malformed / partial output yields an
 * empty or partial map (callers then treat listeners as unidentified → safe).
 * Exported for testing.
 * @param {string} output
 * @returns {Map<number, string>}
 */
export function parseCommandLineJson(output) {
  const map = new Map();
  if (typeof output !== 'string' || !output.trim()) return map;
  let data;
  try {
    data = JSON.parse(output);
  } catch {
    return map;
  }
  const rows = Array.isArray(data) ? data : data == null ? [] : [data];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const pid = Number(row.ProcessId);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (typeof row.CommandLine === 'string' && row.CommandLine) {
      map.set(pid, row.CommandLine);
    }
  }
  return map;
}

/**
 * Fetch command lines for many PIDs in a single CIM query (instead of one
 * PowerShell spawn per PID). PIDs are validated as positive integers before
 * being embedded in the WQL filter, so arbitrary strings cannot be injected.
 * Returns an empty map when PowerShell is unavailable, times out, or returns
 * unparseable output — callers then identify nothing and kill only the owned
 * tree (safe side).
 * @param {number[]} pids
 * @returns {Map<number, string>}
 */
function getCommandLineMap(pids) {
  const ids = [
    ...new Set(
      (Array.isArray(pids) ? pids : [])
        .map((p) => Number(p))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
  if (ids.length === 0) return new Map();
  // Only validated integers reach the filter, so this cannot inject commands.
  const filter = ids.map((id) => `ProcessId=${id}`).join(' OR ');
  let output;
  try {
    output = runPowerShell(
      `ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter '${filter}' | Select-Object ProcessId, CommandLine)`,
    );
  } catch {
    return new Map();
  }
  return parseCommandLineJson(output);
}

/**
 * Build an ownership predicate for a set of port listeners using ONE batched
 * command-line query. The returned `(pid) => boolean` reuses the build guard's
 * identification (web dir + `next start`), so the stop path and the guard agree
 * on what counts as "our" WebUI. A listener that cannot be fetched/identified
 * returns false — we never kill a process we cannot positively identify.
 * @param {number[]} listenerPids
 * @returns {(pid: number) => boolean}
 */
function makeOwnedWebListenerPredicate(listenerPids) {
  const commandLines = getCommandLineMap(listenerPids);
  return (pid) => {
    const commandLine = commandLines.get(Number(pid));
    if (!commandLine) return false;
    return isThisWebUiNextStart(commandLine, WEB_DIR);
  };
}

function isPortInUse(port, snapshot) {
  return getListeningPids(port, snapshot).length > 0;
}

/**
 * Scans the candidate range against a single netstat snapshot: the answer is a
 * point-in-time decision anyway, and re-running netstat per candidate cost up
 * to 20 x ~150 ms on the fallback path.
 */
function findFreePort(startPort, maxAttempts = 20) {
  const snapshot = captureNetstat();
  for (let port = startPort; port < startPort + maxAttempts; port += 1) {
    if (!isPortInUse(port, snapshot)) return port;
  }
  return null;
}

/**
 * If `port` is free → start fresh.
 * If healthy HTTP → reuse.
 * If occupied by a live but unhealthy process → kill and reuse the port.
 * If occupied by a ghost/dead PID (Windows TCP leak) → fall back to the next free port.
 */
async function resolveOccupiedPort(port, healthUrl, label, snapshot) {
  // `snapshot` is only safe for this first probe: everything below either
  // kills a process or waits for the port to change, so it re-runs netstat.
  if (!isPortInUse(port, snapshot)) {
    return { port, reuse: false };
  }

  if (await isHttpUp(healthUrl)) {
    return { port, reuse: true };
  }

  const listeningPids = getListeningPids(port);
  const livePids = listeningPids.filter((pid) => isProcessAlive(pid));

  if (livePids.length > 0) {
    if (label === 'OpenCode') {
      const disposed = await disposeOpencodeServer(OPENCODE_URL);
      if (disposed) await sleep(750);
    }
    for (const pid of livePids) {
      log(
        `Port ${port} holds unresponsive ${label} (PID ${pid}). Stopping gently then force-killing if needed…`,
      );
      if (label === 'OpenCode') {
        await stopProcessTreeGracefully({
          pid,
          softKill: softKillTree,
          hardKill: killProcessTree,
          isAlive: isProcessAlive,
          sleep,
          softWaitMs: 2000,
          pollMs: 250,
        });
      } else {
        killProcessTree(pid);
      }
    }
    for (let i = 0; i < 40; i += 1) {
      await sleep(250);
      if (!isPortInUse(port)) {
        return { port, reuse: false, mutated: true };
      }
    }
  }

  // Ghost socket (LISTENING PID gone) or kill did not free the port.
  const fallback = findFreePort(port + 1);
  if (fallback == null) {
    throw new Error(
      `Port ${port} is stuck (PID ${listeningPids.join(',') || 'unknown'} not responding) ` +
        `and no alternate port is free. Reboot Windows to clear the ghost socket, then retry.`,
    );
  }
  log(
    `Port ${port} is stuck (ghost/unresponsive ${label}). Falling back to :${fallback}`,
  );
  return { port: fallback, reuse: false, fallbackFrom: port, mutated: true };
}

function killProcessTree(pid) {
  hardKillTree(pid);
}

/**
 * Prefer dispose + soft kill so Windows does not orphan the listen socket.
 * Falls back to taskkill /F only if the process is still alive.
 */
async function stopOpencodeProcessTree(pids) {
  const unique = [...new Set(pids.filter(Boolean))];
  if (unique.length === 0) return;

  const disposed = await disposeOpencodeServer(OPENCODE_URL);
  if (disposed) {
    log('OpenCode /global/dispose acknowledged — waiting for children to release handles');
    await sleep(750);
  }

  for (const pid of unique) {
    if (!isProcessAlive(pid)) continue;
    const how = await stopProcessTreeGracefully({
      pid,
      softKill: softKillTree,
      hardKill: killProcessTree,
      isAlive: isProcessAlive,
      sleep,
      softWaitMs: 3000,
      pollMs: 250,
    });
    if (how === 'soft') {
      log(`OpenCode PID ${pid} stopped without force-kill`);
    } else if (how === 'hard') {
      log(`OpenCode PID ${pid} required force-kill (/F)`);
    }
  }
}

/** After crash/force-kill, reap children that may still hold an inherited listen handle. */
function reapOpencodePortHolders(exitedPid) {
  const listeningPids = getListeningPids(OPENCODE_PORT);
  const killed = reapInheritedHolders({
    exitedPid,
    listeningPids,
    listChildren: listChildPids,
    isAlive: isProcessAlive,
    hardKill: killProcessTree,
  });
  if (killed.length > 0) {
    log(
      `Reaped ${killed.length} leftover process(es) that may hold :${OPENCODE_PORT} (${killed.join(', ')})`,
    );
  }
}

function openBrowser(url) {
  spawn('cmd', ['/c', 'start', '', url], {
    detached: true,
    stdio: 'ignore',
    shell: false,
  }).unref();
}

function shouldOpenBrowser() {
  return process.env.OPENCODE_WEBUI_NO_BROWSER !== '1' && readBrowserConfig().autoOpenBrowser;
}

function findOpencode() {
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
}

/** Auto-update OpenCode CLI once per host start, before `serve` spawns.
 *  Disable with OPENCODE_WEBUI_AUTO_UPDATE_OPENCODE=0 (or =false). */
const OPENCODE_AUTO_UPDATE = !['0', 'false'].includes(
  String(process.env.OPENCODE_WEBUI_AUTO_UPDATE_OPENCODE ?? '').toLowerCase(),
);
/** Bounded so a slow/unreachable update channel never blocks startup long. */
const OPENCODE_UPGRADE_TIMEOUT_MS = 180_000;

/**
 * Run `opencode upgrade` non-interactively (no TTY). Resolves without
 * throwing; the caller logs the outcome and continues with the existing
 * binary on any failure. Output is teed into the disk log / ring buffer like
 * the `serve` process, so the WebUI host log shows what happened.
 * @param {string} opencodePath
 * @param {number} [timeoutMs]
 * @returns {Promise<{ ok: boolean, message?: string, code?: number | null }>}
 */
function runOpencodeUpgrade(opencodePath, timeoutMs = OPENCODE_UPGRADE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const useShell = /\.(cmd|bat)$/i.test(opencodePath);
    const child = spawn(opencodePath, ['upgrade'], {
      cwd: REPO_ROOT,
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
 * Best-effort `opencode --version` for the resolved CLI. Returns null when
 * the path is a shell shim or the call fails (never throws).
 * @param {string} opencodePath
 * @returns {string | null}
 */
function readOpencodeVersion(opencodePath) {
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
 * Auto-update the OpenCode CLI before `serve` spawns (runs at every host
 * start; `opencode upgrade` is a no-op when already current). Never throws:
 * failures are logged and startup continues with the existing binary. After a
 * successful package-manager upgrade, a skipped-postinstall stub is repaired
 * so the freshly installed binary is actually runnable.
 * @returns {Promise<{ upgraded: boolean, version: string | null }>}
 */
async function upgradeOpencodeCli() {
  if (!OPENCODE_AUTO_UPDATE) {
    log(
      'OpenCode CLI auto-update is disabled (OPENCODE_WEBUI_AUTO_UPDATE_OPENCODE=0)',
    );
    return { upgraded: false, version: null };
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
  const result = await runOpencodeUpgrade(opencodePath);
  if (!result.ok) {
    error(
      `OpenCode CLI upgrade failed (${result.message ?? 'unknown'}) — continuing with the existing binary`,
    );
    return { upgraded: false, version: null };
  }
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

/**
 * Pick a cursor-acp proxy port that is free or healthy. Avoids Windows ghost
 * sockets on :32124 (TCP accept, no /health) that make Auto hang forever —
 * including image prompts that never reach cursor-agent.
 * @returns {number}
 */
function resolveCursorAcpProxyPort() {
  const primary = 32124;
  const fallback = 32125;
  const forced = Number(process.env.CURSOR_ACP_PROXY_PORT);
  if (Number.isFinite(forced) && forced > 0) {
    // Honor explicit override only when that port is free or already healthy.
    if (!isPortInUse(forced)) return forced;
    try {
      execFileSync(
        process.execPath,
        [
          '-e',
          `fetch('http://127.0.0.1:${forced}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
        ],
        { timeout: 2500, stdio: 'ignore', windowsHide: true },
      );
      return forced;
    } catch {
      log(
        `CURSOR_ACP_PROXY_PORT=${forced} is hung; ignoring and re-resolving`,
      );
    }
  }
  if (!isPortInUse(primary)) return primary;
  try {
    execFileSync(
      process.execPath,
      [
        '-e',
        `fetch('http://127.0.0.1:${primary}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
      ],
      { timeout: 2500, stdio: 'ignore', windowsHide: true },
    );
    return primary;
  } catch {
    log(
      `cursor-acp proxy :${primary} is hung/unhealthy; OpenCode will use :${fallback}`,
    );
    return fallback;
  }
}

function spawnOpencode(opencodePath) {
  const useShell = /\.(cmd|bat)$/i.test(opencodePath);
  const proxyPort = resolveCursorAcpProxyPort();
  const child = spawn(
    opencodePath,
    ['serve', '--hostname', '127.0.0.1', '--port', String(OPENCODE_PORT)],
    {
      cwd: REPO_ROOT,
      shell: useShell,
      stdio: 'pipe',
      windowsHide: true,
      env: {
        ...process.env,
        CURSOR_ACP_PROXY_PORT: String(proxyPort),
        ...browserBridgeEnvironment(),
      },
    },
  );
  opencodeProc = child;

  child.on('error', (err) => {
    error(`OpenCode spawn error: ${err.message}`);
  });

  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`[opencode] ${chunk}`);
    recordLog('opencode', 'log', chunk.toString());
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[opencode] ${chunk}`);
    recordLog('opencode', 'error', chunk.toString());
  });
  child.on('exit', (code, signal) => {
    const exitedPid = child.pid;
    const expected = exitedPid ? expectedOpencodeExitPids.delete(exitedPid) : false;
    const wasCurrent = opencodeProc === child;
    if (!quitting) {
      log(`OpenCode exited (code=${code}, signal=${signal ?? 'none'})`);
    }
    if (wasCurrent) opencodeProc = null;

    const exitDecision = getOpencodeExitDecision({
      quitting,
      exitedPid,
      currentPid: wasCurrent ? exitedPid : null,
      isPlannedExit: expected,
      restartBudgetAvailable:
        !quitting && Boolean(exitedPid) && !expected && wasCurrent
          ? shouldRestartOpencode()
          : false,
    });
    for (const { level, message } of exitDecision.logMessages) {
      if (level === 'error') error(message);
      else log(message);
    }
    // Only an unexpected exit of the current process can leave an inherited
    // listener behind. Planned or stale exits must not trigger recovery work.
    if (exitDecision.shouldReapPortHolders) {
      try {
        reapOpencodePortHolders(exitedPid);
      } catch (err) {
        error(
          `OpenCode orphan reap failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (exitDecision.shouldAutoRestart) {
        setTimeout(async () => {
          try {
            const opencodePath = findOpencode();
            spawnOpencode(opencodePath);
            const ready = await waitUntilReady(`${OPENCODE_URL}/global/health`, 'OpenCode', 45, {
              proc: () => opencodeProc,
            });
            if (!ready) {
              throw new Error(
                `OpenCode failed to become ready on :${OPENCODE_PORT} (${OPENCODE_URL}/global/health)`,
              );
            }
          } catch (restartErr) {
            error(
              `OpenCode auto-restart failed: ${restartErr instanceof Error ? restartErr.message : String(restartErr)}`,
            );
          }
        }, 1000);
      }
    }
    refreshStatusMenu();
  });
}

export function findCaddy() {
  try {
    const output = execSync('where.exe caddy', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = output
      .trim()
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    const exe = lines.find((p) => /\.exe$/i.test(p));
    return exe || lines[0] || null;
  } catch {
    // WinGet's Links directory is not always present on PATH in a process
    // launched from Explorer, even though the registered shim exists there.
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const wingetLink = join(
        localAppData,
        'Microsoft',
        'WinGet',
        'Links',
        'caddy.exe',
      );
      if (existsSync(wingetLink)) return wingetLink;
    }
    return null;
  }
}

/** Current non-internal IPv4 addresses of this machine. */
function localIpv4Addresses() {
  const found = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.internal) continue;
      const family = String(info.family);
      if (family !== 'IPv4' && family !== '4') continue;
      found.push(info.address);
    }
  }
  return found;
}

/**
 * Point the Caddyfile's HTTPS site block at the machine's current LAN IPs.
 *
 * `tls internal` only issues certificates for names listed in the site block,
 * and a Host that matches no block is rejected before TLS finishes. A
 * hardcoded IP therefore breaks phone access the moment DHCP reassigns the
 * address or a second NIC (Wi-Fi alongside Ethernet) joins the same subnet:
 * the phone gets ERR_CONNECTION_FAILED while the host PC still works over
 * loopback, which makes the failure very hard to attribute.
 */
function syncCaddyfileAddresses() {
  try {
    const current = readFileSync(CADDYFILE, 'utf8');
    const { text, changed, addresses } = syncCaddySiteAddresses(
      current,
      localIpv4Addresses(),
    );
    if (!changed) return;
    writeFileSync(CADDYFILE, text, 'utf8');
    log(`Caddyfile site addresses synced to local IPs: ${addresses.join(', ')}`);
  } catch (err) {
    // Never block startup on this: Caddy still runs with the existing file.
    error(
      `Failed to sync Caddyfile addresses: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/** Ensure a Caddyfile exists, seeding from the bundled example on first run. */
export function ensureCaddyfile() {
  if (existsSync(CADDYFILE)) {
    syncCaddyfileAddresses();
    return true;
  }
  try {
    if (existsSync(CADDYFILE_EXAMPLE)) {
      writeFileSync(CADDYFILE, readFileSync(CADDYFILE_EXAMPLE, 'utf8'), 'utf8');
      log(`Created ${CADDYFILE} from example — edit domain/auth before remote use`);
      syncCaddyfileAddresses();
      return true;
    }
  } catch (err) {
    error(`Failed to seed Caddyfile: ${err instanceof Error ? err.message : err}`);
  }
  return false;
}

function spawnCaddy() {
  const caddyPath = findCaddy();
  if (!caddyPath) {
    error('Caddy enabled but not found on PATH. Install Caddy or unset OPENCODE_WEBUI_CADDY.');
    return;
  }
  if (!ensureCaddyfile()) {
    error(`Caddy enabled but no Caddyfile at ${CADDYFILE}.`);
    return;
  }

  log(`Starting Caddy: ${caddyPath} (config ${CADDYFILE})`);
  caddyProc = spawn(
    caddyPath,
    ['run', '--config', CADDYFILE, '--adapter', 'caddyfile'],
    {
      cwd: REPO_ROOT,
      shell: false,
      stdio: 'pipe',
      windowsHide: true,
    },
  );

  caddyProc.on('error', (err) => {
    error(`Caddy spawn error: ${err.message}`);
  });
  caddyProc.stdout?.on('data', (chunk) => {
    process.stdout.write(`[caddy] ${chunk}`);
    recordLog('caddy', 'log', chunk.toString());
  });
  caddyProc.stderr?.on('data', (chunk) => {
    process.stderr.write(`[caddy] ${chunk}`);
    recordLog('caddy', 'error', chunk.toString());
  });
  caddyProc.on('exit', (code, signal) => {
    const abnormal = !quitting && code !== 0 && code !== null;
    if (!quitting) {
      log(`Caddy exited (code=${code}, signal=${signal ?? 'none'})`);
    }
    caddyProc = null;

    if (abnormal && shouldRestartCaddy()) {
      log('Caddy crashed — attempting auto-restart…');
      setTimeout(() => {
        try {
          spawnCaddy();
        } catch (err) {
          error(
            `Caddy auto-restart failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }, 1500);
    } else if (abnormal) {
      error('Caddy restart budget exhausted (3/5min) — manual host restart required');
    }

    refreshStatusMenu();
  });
}

/**
 * True when a caddy.exe command line was started with our Caddyfile
 * (`run --config <path>`). Used so takeover does not kill unrelated Caddy.
 * @param {string | null | undefined} commandLine
 * @param {string} caddyfile
 */
export function isOurCaddyCommandLine(commandLine, caddyfile) {
  if (typeof commandLine !== 'string' || !commandLine || !caddyfile) return false;
  const normalizedCmd = commandLine.replace(/\//g, '\\').toLowerCase();
  const normalizedFile = String(caddyfile).replace(/\//g, '\\').toLowerCase();
  if (!normalizedCmd.includes(normalizedFile)) return false;
  return /\bcaddy(\.exe)?\b/i.test(commandLine) && /--config/i.test(commandLine);
}

/**
 * Stop any stray Caddy left behind when taking over a degraded host. That host
 * is killed without /T so its OpenCode/WebUI can be reused via health check, but
 * Caddy has no port-reuse path in resolvePortPlan and still holds its ports —
 * a fresh spawnCaddy() would fail to bind and orphan the old process. Only used
 * on the abnormal takeover path, and only when this host manages Caddy.
 * Only kills caddy.exe instances whose command line references our Caddyfile.
 */
function stopStrayCaddy() {
  try {
    const output = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='caddy.exe'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"`,
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    const rows = (() => {
      try {
        const parsed = JSON.parse(String(output || '').trim() || 'null');
        if (!parsed) return [];
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    })();
    let stopped = 0;
    for (const row of rows) {
      const pid = Number(row?.ProcessId);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      if (!isOurCaddyCommandLine(row?.CommandLine, CADDYFILE)) continue;
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        stopped += 1;
      } catch {
        /* already gone */
      }
    }
    if (stopped > 0) {
      log(
        `Stopped ${stopped} orphaned Caddy process(es) from the degraded host before takeover`,
      );
    }
  } catch {
    // No stray Caddy running / CIM unavailable.
  }
}

function removeBrokenWebBuild() {
  const buildDir = WEB_DIST_DIR;
  if (!existsSync(buildDir) || existsSync(join(buildDir, 'BUILD_ID'))) return;
  log(`Removing incomplete production build: ${buildDir}`);
  rmSync(buildDir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 250,
  });
}

/**
 * Run npm through its JavaScript CLI instead of a .cmd shell shim. This keeps
 * every argument separate and avoids Node's shell:true quoting vulnerability.
 */
function spawnNpm(args, options) {
  if (!cachedNpmCli) {
    const candidates = [
      process.env.npm_execpath,
      join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ].filter(Boolean);

    try {
      const npmCommands = execFileSync('where.exe', ['npm.cmd'], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      for (const npmCommand of npmCommands) {
        candidates.push(
          join(dirname(npmCommand), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        );
      }
    } catch {
      // The normal Node-adjacent candidate above still covers standard installs.
    }

    cachedNpmCli = candidates.find((candidate) => existsSync(candidate)) || null;
    if (!cachedNpmCli) {
      throw new Error('npm-cli.js was not found. Reinstall Node.js with npm included.');
    }
  }

  return spawn(process.execPath, [cachedNpmCli, ...args], {
    ...options,
    shell: false,
  });
}

/**
 * Build the production WebUI when prod mode has no usable or stale BUILD_ID.
 * Concurrent callers (e.g. overlapping restart triggers) share the same
 * in-flight build instead of starting a second `npm run build`, which would
 * otherwise let `removeBrokenWebBuild()` delete the first build's output
 * mid-flight.
 */
function buildWebProduction(reason = 'missing') {
  if (webBuildPromise) return webBuildPromise;
  webBuildPromise = buildWebProductionInternal(reason).finally(() => {
    webBuildPromise = null;
  });
  return webBuildPromise;
}

function buildWebProductionInternal(reason = 'missing') {
  return new Promise((resolve, reject) => {
    removeBrokenWebBuild();
    const reasonText =
      reason === 'stale'
        ? 'Production WebUI build is stale (sources newer than BUILD_ID); rebuilding before start…'
        : 'Production WebUI build is missing; rebuilding before start…';
    log(reasonText);
    mkdirSync(WEB_DIST_DIR, { recursive: true });
    // Syncs the hard-link mirror and builds there; see scripts/build-web.mjs.
    const child = spawn(process.execPath, [join(REPO_ROOT, 'scripts', 'build-web.mjs')], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      windowsHide: true,
      env: { ...process.env },
    });
    webBuildProc = child;
    void refreshStatusMenu();
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (webBuildProc === child) webBuildProc = null;
      void refreshStatusMenu();
      if (err) reject(err);
      else resolve();
    };
    child.stdout?.on('data', (chunk) => {
      process.stdout.write(`[web-build] ${chunk}`);
      recordLog('web-build', 'log', chunk.toString());
    });
    child.stderr?.on('data', (chunk) => {
      process.stderr.write(`[web-build] ${chunk}`);
      recordLog('web-build', 'error', chunk.toString());
    });
    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      if (code !== 0) {
        finish(new Error(`WebUI production build failed (code=${code})`));
        return;
      }
      if (!existsSync(join(WEB_DIST_DIR, 'BUILD_ID'))) {
        finish(new Error('WebUI production build finished without BUILD_ID'));
        return;
      }
      log('Production WebUI build completed');
      finish();
    });
  });
}

function armWebStableReset(child) {
  if (webStableTimer) clearTimeout(webStableTimer);
  webStableTimer = setTimeout(() => {
    if (webProc === child && procRunning(child)) {
      webRestarts = 0;
      webCoolDownAnnounced = false;
    }
  }, 60000);
  webStableTimer.unref?.();
}

async function spawnWeb() {
  // Safe here: resolvePortPlan has freed or taken over the WebUI port, so no
  // server is serving the legacy in-repo build anymore.
  removeLegacyInRepoBuild();
  let hasBuild = existsSync(join(WEB_DIST_DIR, 'BUILD_ID'));
  let buildStale = hasBuild && isWebBuildStale(WEB_DIR, WEB_DIST_DIR);
  let plan = getWebLaunchPlan(process.env.OPENCODE_WEBUI_MODE, hasBuild, buildStale);
  if (plan.needsBuild) {
    const rebuildReason = hasBuild && buildStale ? 'stale' : 'missing';
    try {
      await buildWebProduction(rebuildReason);
    } catch (err) {
      // build-web.mjs restores a stashed `.next` after failure. If that left a
      // usable BUILD_ID, prefer serving the last good production build over
      // exiting the tray host with no WebUI at all.
      hasBuild = existsSync(join(WEB_DIST_DIR, 'BUILD_ID'));
      if (rebuildReason === 'stale' && hasBuild) {
        error(
          `WebUI stale rebuild failed; continuing with the existing production build (${err instanceof Error ? err.message : String(err)})`,
        );
      } else {
        throw err;
      }
    }
    hasBuild = existsSync(join(WEB_DIST_DIR, 'BUILD_ID'));
    buildStale = hasBuild && isWebBuildStale(WEB_DIR, WEB_DIST_DIR);
    plan = getPostBuildLaunchPlan(process.env.OPENCODE_WEBUI_MODE, hasBuild, buildStale);
    if (plan.staleAfterBuild) {
      log(
        'Sources changed while the WebUI build ran; starting the fresh build anyway (the next restart will rebuild)',
      );
    }
  }
  if (plan.needsBuild) throw new Error('WebUI production build is unavailable');
  const useProd = plan.useProd;

  // Production serves the mirrored project, so `next start` is invoked
  // directly there instead of through npm in the installation.
  const serveDir = useProd ? WEB_MIRROR_DIR : WEB_DIR;
  const serverArgs = ['--hostname', WEBUI_HOST, '--port', String(WEBUI_PORT)];

  log(`Starting WebUI (${useProd ? 'production' : 'dev'}) on ${WEBUI_HOST}:${WEBUI_PORT} in ${serveDir}`);
  const spawnServer = (options) =>
    useProd
      ? spawn(
          process.execPath,
          [join(WEB_MIRROR_DIR, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', ...serverArgs],
          options,
        )
      : spawnNpm(['run', 'dev', '--', ...serverArgs], options);
  const child = spawnServer({
    cwd: serveDir,
    stdio: 'pipe',
    windowsHide: true,
    env: {
      ...process.env,
      // The mirror is a copy: git-backed features must still act on the
      // installation (web/src/lib/install-root.ts).
      OPENCODE_WEBUI_INSTALL_ROOT: REPO_ROOT,
      OPENCODE_BASE_URL: OPENCODE_URL,
      OPENCODE_PORT: String(OPENCODE_PORT),
      OPENCODE_WEBUI_HOST: WEBUI_HOST,
      OPENCODE_WEBUI_PORT: String(WEBUI_PORT),
      OPENCODE_WEBUI_HOST_CONTROL_URL: CONTROL_URL,
      // Packaged WebUI launches should expose the Workflow entry point by
      // default. Preserve an explicit false/0 override for safe rollout.
      OPENCODE_WEBUI_WORKFLOW_MODE:
        process.env.OPENCODE_WEBUI_WORKFLOW_MODE ?? 'true',
      // Read-only Graph is the packaged rollout default. Keep semantic edit
      // opt-in separately in the WebUI environment.
      OPENCODE_WEBUI_WORKFLOW_GRAPH:
        process.env.OPENCODE_WEBUI_WORKFLOW_GRAPH ?? 'true',
      // Keep semantic Graph editing opt-in until all acceptance gates pass.
      // Preserve an explicit true/1 override for controlled rollout.
      OPENCODE_WEBUI_WORKFLOW_GRAPH_EDIT:
        process.env.OPENCODE_WEBUI_WORKFLOW_GRAPH_EDIT ?? 'false',
      ...browserBridgeEnvironment(),
      PORT: String(WEBUI_PORT),
      // Production serves the mirror's own `.next`, which is the default, so
      // any inherited NEXT_DIST_DIR must be cleared. Dev keeps its own value:
      // web/scripts/dev.mjs defaults it to .next-dev.
      ...(useProd ? { NEXT_DIST_DIR: '' } : {}),
      // When Caddy fronts the WebUI with HTTPS, advertise its public origin so
      // /api/access shows the reachable URL instead of http://IP:3000.
      ...(detectCaddyPublicUrl()
        ? { OPENCODE_WEBUI_PUBLIC_URL: detectCaddyPublicUrl() }
        : {}),
      ...(detectCaddyLoopbackUrl()
        ? { OPENCODE_WEBUI_CADDY_LOCAL_URL: detectCaddyLoopbackUrl() }
        : {}),
    },
  });
  webProc = child;
  webStartedAt = Date.now();
  webHealthFailures = 0;
  armWebStableReset(child);

  child.on('error', (err) => {
    error(`WebUI spawn error: ${err.message}`);
  });

  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`[webui] ${chunk}`);
    recordLog('webui', 'log', chunk.toString());
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[webui] ${chunk}`);
    recordLog('webui', 'error', chunk.toString());
  });
  child.on('close', (code, signal) => {
    const expected = child.pid ? expectedWebExitPids.delete(child.pid) : false;
    const wasCurrent = webProc === child;
    if (!quitting) {
      log(`WebUI exited (code=${code}, signal=${signal ?? 'none'})`);
    }
    if (wasCurrent) {
      webProc = null;
      if (webStableTimer) {
        clearTimeout(webStableTimer);
        webStableTimer = null;
      }
    }
    refreshStatusMenu();
    if (!quitting && !expected && wasCurrent) scheduleWebRestart();
  });
}

async function checkWebHealth() {
  if (quitting || restartingServices || webHealthCheckInFlight || !procRunning(webProc)) return;
  webHealthCheckInFlight = true;
  try {
    const decision = webHealthDecision({
      httpUp: await isHttpUp(WEBUI_URL),
      consecutiveFailures: webHealthFailures,
      startedAt: webStartedAt,
      startupGraceMs: WEB_WATCHDOG_STARTUP_GRACE_MS,
      failureLimit: WEB_WATCHDOG_FAILURE_LIMIT,
    });
    webHealthFailures = decision.consecutiveFailures;
    if (!decision.shouldRestart || webProc == null) return;

    error(`WebUI health check failed ${webHealthFailures} times; recovering the hung process`);
    restartingServices = true;
    try {
      await stopWebOnly({ preserveRestartBudget: true });
      scheduleWebRestart();
    } catch (err) {
      error(`WebUI hang recovery failed: ${err instanceof Error ? err.message : String(err)}`);
      scheduleWebRestart();
    } finally {
      restartingServices = false;
    }
  } finally {
    webHealthCheckInFlight = false;
  }
}

function startWebWatchdog() {
  if (webWatchdogTimer) return;
  webWatchdogTimer = setInterval(() => {
    void checkWebHealth().catch((err) => {
      error(`WebUI health check failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, WEB_WATCHDOG_INTERVAL_MS);
  webWatchdogTimer.unref?.();
}

function scheduleWebRestart() {
  if (quitting || webRestartTimer || procRunning(webProc)) return;
  webRestarts += 1;
  const { delayMs: delay, coolingDown } = webRestartSchedule(
    webRestarts,
    MAX_WEB_RESTARTS,
  );
  // Log the transition into cool-down only once to avoid spamming the same
  // message every 60s while the WebUI stays broken. The tray host is the only
  // thing that can bring the WebUI back, so we never give up.
  if (coolingDown && !webCoolDownAnnounced) {
    log(
      `WebUI restart burst exhausted (${MAX_WEB_RESTARTS}); entering 60s cool-down retry loop (never gives up)`,
    );
    webCoolDownAnnounced = true;
  } else if (!coolingDown) {
    log(`Restarting WebUI in ${delay}ms (attempt ${webRestarts}/${MAX_WEB_RESTARTS})…`);
  }
  webRestartTimer = setTimeout(() => {
    webRestartTimer = null;
    void (async () => {
      if (quitting || procRunning(webProc)) return;
      if (await isHttpUp(WEBUI_URL)) {
        // WebUI is healthy again — reset the counter and clear the cool-down
        // announcement so a future failure burst starts fresh.
        webRestarts = 0;
        webCoolDownAnnounced = false;
        await refreshStatusMenu();
        return;
      }
      try {
        await spawnWeb();
        await refreshStatusMenu();
      } catch (err) {
        error(`WebUI restart failed: ${err instanceof Error ? err.message : String(err)}`);
        scheduleWebRestart();
      }
    })();
  }, delay);
  webRestartTimer.unref?.();
}

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * One-time best-effort cleanup of the legacy in-repo `web/.next` production
 * build output. Dev uses `.next-dev` and e2e uses `.next-e2e`, so `web/.next`
 * is unambiguously legacy production output once the build lives elsewhere
 * (default: %APPDATA%\opencode-webui\web-build). Only removed when the new
 * distDir actually differs from web/.next; errors are swallowed.
 *
 * Called from spawnWeb() only: by then resolvePortPlan has either found the
 * WebUI port free or taken over (killed) a stale listener of our own, so no
 * server is serving web/.next anymore. Never run it at startup while a
 * healthy WebUI may be reused in place — deleting its files mid-serve would
 * cause the very ChunkLoadError the build guard exists to prevent.
 */
function removeLegacyInRepoBuild() {
  // web/.next (before the output moved out of the repo) and the external
  // %APPDATA% distDir (before the whole project moved into the build mirror).
  const legacyDirs = [join(WEB_DIR, '.next'), join(DATA_DIR, 'web-build')];
  for (const legacy of legacyDirs) {
    try {
      if (resolve(WEB_DIST_DIR) === resolve(legacy)) continue;
      if (!existsSync(legacy)) continue;
      rmSync(legacy, { recursive: true, force: true });
      log(`Production build output moved to ${WEB_DIST_DIR}; removed legacy ${legacy}`);
    } catch {
      // Swallow: best-effort cleanup of superseded build output.
    }
  }
}

/**
 * Lock file format: JSON `{ pid, created }` where `created` is the host
 * process creation time (FILETIME). Legacy format was a bare PID string;
 * it is still readable (`created` will be null).
 */
function readLock() {
  if (!existsSync(LOCK_FILE)) return null;
  try {
    const raw = readFileSync(LOCK_FILE, 'utf8').trim();
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

function readLockPid() {
  return readLock()?.pid ?? null;
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
function writeLock() {
  writeFileSync(
    LOCK_FILE,
    JSON.stringify({ pid: process.pid, created: null, createdPending: true }),
    { encoding: 'utf8', flag: 'wx' },
  );
  backfillLockCreationTime();
}

function backfillLockCreationTime() {
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
      if (readLock()?.pid !== process.pid) return;
      writeFileSync(
        LOCK_FILE,
        JSON.stringify({ pid: process.pid, created }),
        'utf8',
      );
    })
    .catch(() => {
      // Leave the pending lock as is; identity checks fall back to the
      // command line, exactly as they do when CIM is unavailable.
    });
}

function removeLock() {
  if (!existsSync(LOCK_FILE)) return;
  try {
    const lockPid = readLockPid();
    if (lockPid === process.pid) {
      unlinkSync(LOCK_FILE);
      removeControlFile();
    }
  } catch {
    // best effort
  }
}

async function handleExistingInstance() {
  const lock = readLock();
  if (lock == null) {
    if (existsSync(LOCK_FILE)) {
      try {
        unlinkSync(LOCK_FILE);
        log('Removed unreadable host lock');
      } catch {
        // The exclusive write will retry or report the lock failure.
      }
    }
    return false;
  }
  const lockPid = lock.pid;

  const removeStaleLock = (reason) => {
    const current = readLock();
    if (
      current?.pid !== lock.pid ||
      current?.created !== lock.created
    ) {
      log(`Lock changed while checking PID ${lockPid}; leaving it untouched`);
      return;
    }
    try {
      unlinkSync(LOCK_FILE);
      log(`Removed stale lock (PID ${lockPid}): ${reason}`);
    } catch {
      // continue
    }
  };

  if (!isProcessAlive(lockPid)) {
    removeStaleLock('process is gone');
    return false;
  }

  // The PID may have been reused by an unrelated process after a crash.
  // Verify identity: exact creation-time match when the lock records it,
  // otherwise (legacy lock) a conservative command-line heuristic.
  let hostIdentityVerified = false;

  // Stricter fallback used whenever CreationDate cannot be compared: requires
  // the command line to name the host directory or product, so an unrelated
  // node process is never misidentified (and taskkilled).
  const verifyStrictlyByCommandLine = () => {
    const cmdline = getProcessCommandLine(lockPid);
    if (cmdline && !stronglyLooksLikeHostCommandLine(cmdline)) {
      removeStaleLock(`PID reused by another process (${cmdline})`);
      return 'reused';
    }
    if (cmdline) return 'verified';
    log(`Could not verify identity of live lock PID ${lockPid}; preserving it`);
    return 'unknown';
  };

  if (lock.created) {
    const created = getProcessCreationTime(lockPid);
    if (created && created !== lock.created) {
      removeStaleLock(`PID reused by another process (created=${created})`);
      return false;
    }
    if (created === lock.created) {
      hostIdentityVerified = true;
    } else {
      const outcome = verifyStrictlyByCommandLine();
      if (outcome === 'reused') return false;
      hostIdentityVerified = outcome === 'verified';
    }
  } else if (lock.createdPending) {
    // The owner is still resolving its creation time (see writeLock).
    const outcome = verifyStrictlyByCommandLine();
    if (outcome === 'reused') return false;
    hostIdentityVerified = outcome === 'verified';
  } else {
    const cmdline = getProcessCommandLine(lockPid);
    if (cmdline && !looksLikeHostCommandLine(cmdline)) {
      removeStaleLock(`PID reused by another process (${cmdline})`);
      return false;
    }
    if (cmdline) hostIdentityVerified = true;
    if (!cmdline) {
      log(`Could not verify identity of live legacy lock PID ${lockPid}; preserving it`);
    }
  }

  // A real host is holding the lock. If it has a tray icon, defer to it.
  // Give a freshly started host a grace period to spawn its tray helper.
  const headless = isHeadless();
  if (!headless && hostIdentityVerified) {
    let tray = hasTrayChild(lockPid);
    if (tray === false) {
      await sleep(3000);
      tray = hasTrayChild(lockPid);
    }
    if (tray === null) {
      log(`Could not inspect tray child for PID ${lockPid}; preserving the running host`);
    } else if (!tray && isProcessAlive(lockPid)) {
      // Degraded host (e.g. tray helper died and restarts were exhausted, or a
      // pre-fix zombie). Take over: kill only the host process — its child
      // services keep running and are reused via resolvePortPlan().
      error(
        `Host PID ${lockPid} is running without a tray icon; taking over to restore it`,
      );
      try {
        execSync(`taskkill /F /PID ${lockPid}`, { stdio: 'ignore' });
      } catch (err) {
        throw new Error(
          `Could not terminate degraded host PID ${lockPid}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (isProcessAlive(lockPid)) {
        throw new Error(`Degraded host PID ${lockPid} is still running after termination`);
      }
      if (CADDY_ENABLED) {
        // The degraded host's Caddy is now orphaned but still holds its ports;
        // let the new host own a fresh, restartable instance instead.
        stopStrayCaddy();
      }
      removeStaleLock('degraded host was terminated');
      return false;
    }
  }

  if (shouldOpenBrowser()) {
    const browserUrl = await resolveBrowserUrl();
    log(`Host already running (PID ${lockPid}). Opening ${browserUrl}`);
    openBrowser(browserUrl);
  } else {
    log(`Host already running (PID ${lockPid}).`);
  }
  process.exit(0);
}

async function acquireLock() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await handleExistingInstance();
    try {
      writeLock();
      return;
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      log(`Host lock changed during startup; retrying (${attempt}/3)`);
      await sleep(100);
    }
  }
  throw new Error('Could not acquire the host lock after 3 attempts');
}

/**
 * Pull the latest commit from the remote into the repo's existing `.git`
 * before the port/reuse plan is decided. Updating sources here lets the
 * existing `isWebBuildStale` checks in `resolvePortPlan` and `spawnWeb`
 * observe the freshly pulled tree, so a pull that brings in newer source
 * files automatically triggers the production rebuild — no separate build
 * trigger needed.
 *
 * Failures (no network, non-fast-forward, local uncommitted edits) are
 * logged once and swallowed: the host continues starting with whatever
 * sources are already on disk, matching the `--ff-only` safety of the
 * manual update route (`POST /api/updates/webui`). No `.git` (zip
 * distribution before git-restore) is a silent no-op.
 */
async function pullLatestWebSource() {
  const result = await pullLatestGitSource(REPO_ROOT, { execFileAsync });
  if (!result.attempted) return; // no .git — zip distribution, handled elsewhere
  if (result.ok) {
    const stdout = (result.stdout ?? '').trim();
    if (stdout && !/^Already up to date\b/.test(stdout)) {
      log(`Git pull updated sources: ${stdout.split('\n')[0]}`);
    }
  } else {
    log(`Git pull skipped: ${result.error ?? 'unknown error'}`);
  }
}

/**
 * @param {{ output: string } | null} [preCaptured] netstat snapshot taken by
 *   the caller (startChildren overlaps it with the git pull). Ports cannot
 *   change as a result of the pull, so an earlier snapshot stays valid.
 */
async function resolvePortPlan(preCaptured) {
  const plan = { startOpencode: true, startWeb: true };

  // Both port probes happen before anything is started, so they can share one
  // netstat run — unless resolving OpenCode killed a process, in which case the
  // snapshot is dropped and the WebUI probe re-runs netstat.
  const netstat = preCaptured ?? captureNetstat();

  const opencode = await resolveOccupiedPort(
    OPENCODE_PORT,
    `${OPENCODE_URL}/global/health`,
    'OpenCode',
    netstat,
  );
  if (opencode.port !== OPENCODE_PORT) {
    setOpencodePort(opencode.port);
    process.env.OPENCODE_PORT = String(OPENCODE_PORT);
    process.env.OPENCODE_BASE_URL = OPENCODE_URL;
  }
  if (opencode.reuse) {
    log(`Reusing existing OpenCode on :${OPENCODE_PORT}`);
    plan.startOpencode = false;
  }

  const webui = await resolveOccupiedPort(
    WEBUI_PORT,
    WEBUI_URL,
    'WebUI',
    opencode.mutated ? null : netstat,
  );
  if (webui.port !== WEBUI_PORT) {
    setWebuiPort(webui.port);
    process.env.OPENCODE_WEBUI_PORT = String(WEBUI_PORT);
  }
  if (webui.reuse) {
    // Reusing a responsive WebUI is usually right, but a stale/missing build
    // (typically an orphaned `next start` from a previous host that exited
    // without reaping its WebUI child) must be rebuilt, not trusted. Take over
    // only when we can positively identify the listener as our own `next
    // start`; never kill an unknown process on the port.
    const hasBuild = existsSync(join(WEB_DIST_DIR, 'BUILD_ID'));
    const buildStale = hasBuild && isWebBuildStale(WEB_DIR, WEB_DIST_DIR);
    const listenerPids = getListeningPids(WEBUI_PORT);
    const isOurs = makeOwnedWebListenerPredicate(listenerPids);
    const ownedListenerPids = listenerPids.filter(isOurs);
    const decision = decideWebReuseOnStale({
      reuse: true,
      mode: process.env.OPENCODE_WEBUI_MODE,
      hasBuild,
      buildStale,
      ownedListenerPids,
    });
    if (decision.reuse) {
      log(
        decision.reason === 'unknown-listener'
          ? `WebUI build is stale but :${WEBUI_PORT} is held by an unknown process; reusing it as-is`
          : `Reusing existing WebUI on :${WEBUI_PORT}`,
      );
      plan.startWeb = false;
    } else if (decision.takeover) {
      log(`Existing WebUI on :${WEBUI_PORT} is stale; stopping it to rebuild`);
      for (const pid of decision.takeover) killProcessTree(pid);
      const freed = await waitForPortFree(WEBUI_PORT, 40);
      if (!freed) {
        log(`Could not free :${WEBUI_PORT} after stopping the stale WebUI; reusing it as-is`);
        plan.startWeb = false;
      }
      // else: plan.startWeb stays true → spawnWeb runs the stale check + rebuild
    }
  }

  return plan;
}

async function isHttpUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForHttpUp(url, attempts = 1, delayMs = 1000) {
  for (let i = 0; i < attempts; i += 1) {
    if (await isHttpUp(url)) return true;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return false;
}

/** Poll interval while waiting for a child service to answer HTTP. */
const READY_POLL_MS = 250;

/**
 * @param {number} attempts Timeout in seconds. The name is historical: the loop
 *   used to probe once per second. Probing every 250 ms instead returns up to
 *   ~750 ms sooner on a normal start while keeping the same overall timeout.
 */
async function waitUntilReady(url, label, attempts = 60, { proc, pollMs = READY_POLL_MS } = {}) {
  const iterations = Math.max(1, Math.ceil((attempts * 1000) / pollMs));
  for (let i = 0; i < iterations; i += 1) {
    if (await isHttpUp(url)) {
      log(`${label} is ready`);
      return true;
    }
    // ServeError / crash: fail fast instead of waiting the full timeout.
    if (proc && !procRunning(proc())) {
      error(`${label} exited before becoming ready (${url})`);
      return false;
    }
    await sleep(pollMs);
  }
  error(`${label} did not become ready in time (${url})`);
  return false;
}

function procRunning(proc) {
  return proc != null && proc.exitCode == null && !proc.killed;
}

async function startChildren() {
  // netstat (~150 ms) does not depend on the pull and the pull cannot change
  // which ports are listening, so overlap them instead of paying for both.
  const netstatPromise = captureNetstatAsync();
  // The CLI upgrade is unrelated to the port plan and can take up to 3 min on
  // a slow channel, so it runs concurrently with the git pull and is only
  // awaited when a fresh `serve` is about to spawn.
  const opencodeUpgradePromise = upgradeOpencodeCli();
  await pullLatestWebSource();
  const plan = await resolvePortPlan(await netstatPromise);
  if (plan.startOpencode) {
    await opencodeUpgradePromise;
    const opencodePath = findOpencode();
    log(`Starting OpenCode: ${opencodePath}`);
    spawnOpencode(opencodePath);
  }
  if (plan.startWeb) {
    await spawnWeb();
  }
  if (CADDY_ENABLED) {
    spawnCaddy();
  }
  await refreshStatusMenu();
}

async function waitForPortFree(port, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    if (!isPortInUse(port)) return true;
    await sleep(250);
  }
  return !isPortInUse(port);
}

async function stopWebOnly({ preserveRestartBudget = false } = {}) {
  if (webRestartTimer) {
    clearTimeout(webRestartTimer);
    webRestartTimer = null;
  }
  if (webStableTimer) {
    clearTimeout(webStableTimer);
    webStableTimer = null;
  }
  if (!preserveRestartBudget) {
    webRestarts = 0;
    webCoolDownAnnounced = false;
  }
  webHealthFailures = 0;

  if (webBuildProc?.pid) {
    killProcessTree(webBuildProc.pid);
    webBuildProc = null;
  }

  // Union of the owned child and identified port listeners, so a reparented
  // `next start` (survived a crash, outside the owned tree) is stopped too
  // without touching an unrelated app on the port. Listeners are identified via
  // a single batched command-line query (one PowerShell spawn, not one per PID).
  const listeningPids = getListeningPids(WEBUI_PORT);
  const pids = resolveWebKillPids({
    ownedPid: webProc?.pid,
    listeningPids,
    isOwnedListener: makeOwnedWebListenerPredicate(listeningPids),
  });
  for (const pid of pids) {
    expectedWebExitPids.add(pid);
    killProcessTree(pid);
  }
  webProc = null;
  await waitForPortFree(WEBUI_PORT);
}

async function stopOpencodeOnly() {
  const pids = resolveKillPids({
    ownedPid: opencodeProc?.pid,
    listeningPids: getListeningPids(OPENCODE_PORT),
  });
  for (const pid of pids) expectedOpencodeExitPids.add(pid);
  opencodeProc = null;
  await stopOpencodeProcessTree(pids);
  await waitForPortFree(OPENCODE_PORT);
}

async function stopChildren() {
  if (webRestartTimer) {
    clearTimeout(webRestartTimer);
    webRestartTimer = null;
  }
  if (webStableTimer) {
    clearTimeout(webStableTimer);
    webStableTimer = null;
  }
  webRestarts = 0;
  webCoolDownAnnounced = false;
  webHealthFailures = 0;
  if (webProc?.pid) expectedWebExitPids.add(webProc.pid);

  const opencodePids = resolveKillPids({
    ownedPid: opencodeProc?.pid,
    listeningPids: getListeningPids(OPENCODE_PORT),
  });
  for (const pid of opencodePids) expectedOpencodeExitPids.add(pid);
  opencodeProc = null;
  const opencodeStop = stopOpencodeProcessTree(opencodePids);

  // WebUI: union of the owned child and identified port listeners. The owned
  // PID covers listeners still in its tree; identified listeners cover a
  // reparented `next start` that survived a crash and keeps holding the port.
  // Unidentified listeners are never killed (protects unrelated apps). Listeners
  // are identified via one batched command-line query.
  const webListeningPids = getListeningPids(WEBUI_PORT);
  const webPids = resolveWebKillPids({
    ownedPid: webProc?.pid,
    listeningPids: webListeningPids,
    isOwnedListener: makeOwnedWebListenerPredicate(webListeningPids),
  });
  const otherPids = [webBuildProc?.pid, caddyProc?.pid].filter(Boolean);
  for (const pid of webPids) {
    expectedWebExitPids.add(pid);
    killProcessTree(pid);
  }
  for (const pid of otherPids) {
    killProcessTree(pid);
  }
  webProc = null;
  webBuildProc = null;
  caddyProc = null;

  // Stop independent services and wait for their ports concurrently. Normal
  // quit does not need OpenCode to finish before the WebUI/Caddy trees begin
  // stopping, and parallel waiting avoids paying both port-release windows in
  // sequence.
  await Promise.all([
    opencodeStop,
    waitForPortFree(WEBUI_PORT),
    waitForPortFree(OPENCODE_PORT),
  ]);
}

function formatStatus(name, proc, httpUp) {
  return formatServiceStatus(name, procRunning(proc), httpUp);
}

async function refreshStatusMenu() {
  const [opencodeUp, webUp] = await Promise.all([
    isHttpUp(`${OPENCODE_URL}/global/health`),
    isHttpUp(WEBUI_URL),
  ]);

  statusOpencodeItem.title = formatStatus('OpenCode', opencodeProc, opencodeUp);
  statusWebuiItem.title = procRunning(webBuildProc)
    ? 'WebUI: building…'
    : formatStatus('WebUI', webProc, webUp);

  // Only push updates to a tray helper whose process is still alive. Once the
  // helper exits, `systray` may linger until the restart lands; sending to it
  // would write to a dead pipe on every poll.
  if (trayAlive()) {
    systray.sendAction({ type: 'update-item', item: statusOpencodeItem });
    systray.sendAction({ type: 'update-item', item: statusWebuiItem });
  }

  if (CADDY_ENABLED) {
    statusCaddyItem.title = procRunning(caddyProc)
      ? 'Caddy: running'
      : 'Caddy: stopped';
    if (trayAlive()) {
      systray.sendAction({ type: 'update-item', item: statusCaddyItem });
    }
  }
}

/** True only when the tray helper exists and its child process is still up. */
function trayAlive() {
  return systray != null && procRunning(systray.process);
}

async function restartWeb() {
  if (restartingServices) {
    log('Service restart is already in progress');
    return;
  }
  restartingServices = true;
  log('Restarting WebUI…');
  try {
    await stopWebOnly();
    await sleep(500);
    await spawnWeb();
  } catch (err) {
    error(`WebUI restart failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    restartingServices = false;
    await refreshStatusMenu();
  }
}

/**
 * Stop the WebUI without scheduling a restart. Used by build.bat via the
 * control plane: going through stopWebOnly() clears the restart timers and
 * registers the PIDs in expectedWebExitPids, so the watchdog does not respawn
 * `next start` on top of the build.
 *
 * NOTE: build.bat no longer calls this (see commit history). The guard now
 * refuses to build while the WebUI is running instead of stopping it. The
 * endpoint and this handler remain for backward compatibility with older
 * build.bat / manual control-plane callers, but must not be relied on by the
 * current build flow.
 */
async function stopWebForBuild() {
  if (restartingServices) {
    log('Service restart is already in progress');
    throw new Error('a service restart is already in progress');
  }
  restartingServices = true;
  log('Stopping WebUI on build request…');
  try {
    await stopWebOnly();
    log('WebUI stopped for build');
  } catch (err) {
    error(`WebUI stop failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    restartingServices = false;
    await refreshStatusMenu();
  }
}

async function restartOpencode() {
  if (restartingServices) {
    log('Service restart is already in progress');
    return;
  }
  restartingServices = true;
  log('Restarting OpenCode…');
  const previousPort = OPENCODE_PORT;
  try {
    await stopOpencodeOnly();
    await sleep(500);

    // Same ghost/unhealthy handling as cold start. Crash+taskkill often leaves a
    // Windows LISTENING socket whose PID is already dead; rebinding then fails
    // with ServeError unless we fall back to the next free port.
    const resolved = await resolveOccupiedPort(
      OPENCODE_PORT,
      `${OPENCODE_URL}/global/health`,
      'OpenCode',
    );
    if (resolved.port !== OPENCODE_PORT) {
      setOpencodePort(resolved.port);
      process.env.OPENCODE_PORT = String(OPENCODE_PORT);
      process.env.OPENCODE_BASE_URL = OPENCODE_URL;
    }

    if (resolved.reuse) {
      log(`Reusing existing OpenCode on :${OPENCODE_PORT}`);
    } else {
      const opencodePath = findOpencode();
      log(`Starting OpenCode: ${opencodePath}`);
      spawnOpencode(opencodePath);
      const ready = await waitUntilReady(
        `${OPENCODE_URL}/global/health`,
        'OpenCode',
        45,
        { proc: () => opencodeProc },
      );
      if (!ready) {
        throw new Error(
          `OpenCode failed to become ready on :${OPENCODE_PORT} (${OPENCODE_URL}/global/health)`,
        );
      }
    }

    // WebUI bakes OPENCODE_BASE_URL at spawn time — follow port changes.
    if (OPENCODE_PORT !== previousPort) {
      log(
        `OpenCode port changed ${previousPort} → ${OPENCODE_PORT}; restarting WebUI to follow…`,
      );
      await stopWebOnly();
      await sleep(500);
      await spawnWeb();
      const webReady = await waitUntilReady(WEBUI_URL, 'WebUI', 60, {
        proc: () => webProc,
      });
      if (!webReady) {
        throw new Error(`WebUI failed to become ready after OpenCode port change (${WEBUI_URL})`);
      }
    }
  } catch (err) {
    error(`OpenCode restart failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    restartingServices = false;
    await refreshStatusMenu();
  }
}

async function restartServices() {
  if (restartingServices) {
    log('Service restart is already in progress');
    return;
  }
  restartingServices = true;
  log('Restarting services…');
  try {
    await stopChildren();
    // stopChildren now awaits waitForPortFree for both ports; no extra sleep needed.
    await startChildren();
  } catch (err) {
    await stopChildren();
    throw err;
  } finally {
    restartingServices = false;
    await refreshStatusMenu();
  }
}

function writeControlFile() {
  writeFileSync(
    CONTROL_FILE,
    JSON.stringify({
      url: CONTROL_URL,
      port: CONTROL_PORT,
      pid: process.pid,
      updatedAt: new Date().toISOString(),
    }),
    'utf8',
  );
}

function removeControlFile() {
  try {
    unlinkSync(CONTROL_FILE);
  } catch {
    // absent
  }
}

function launchWindowsVoiceInput() {
  if (process.platform !== 'win32') {
    throw new Error('Windows voice input is only available on Windows');
  }
  const script = `
$signature = '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);'
Add-Type -MemberDefinition $signature -Name Keyboard -Namespace Win32
[Win32.Keyboard]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero)
[Win32.Keyboard]::keybd_event(0x48, 0, 0, [UIntPtr]::Zero)
[Win32.Keyboard]::keybd_event(0x48, 0, 2, [UIntPtr]::Zero)
[Win32.Keyboard]::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero)
`;
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

/** Windows Firewall inbound rule name shared with scripts/allow-firewall-3000.bat. */
const FIREWALL_RULE_NAME = 'OpenCode WebUI';

/** True when a Windows Firewall inbound rule with FIREWALL_RULE_NAME exists.
 *  Read-only; does not require elevation. */
function firewallRuleExists() {
  try {
    execFileSync(
      'netsh',
      ['advfirewall', 'firewall', 'show', 'rule', `name=${FIREWALL_RULE_NAME}`],
      { stdio: 'ignore', windowsHide: true },
    );
    return true;
  } catch {
    return false;
  }
}

/** Adds an inbound TCP allow rule for the WebUI port via an elevated (UAC)
 *  subprocess, so LAN/phone clients can reach it without a manual .bat run.
 *  Returns immediately (no UAC prompt) when the rule already exists. Throws
 *  if the user cancels the UAC prompt or the elevated command fails.
 *  Windows only — the WebUI itself never runs netsh directly. */
async function allowFirewallPort() {
  if (process.platform !== 'win32') {
    throw new Error('ファイアウォール設定は Windows でのみ対応しています');
  }
  if (firewallRuleExists()) {
    return { alreadyExists: true, port: WEBUI_PORT };
  }
  const script = `
$fwArgs = @('advfirewall','firewall','add','rule','name=${FIREWALL_RULE_NAME}','dir=in','action=allow','protocol=TCP','localport=${WEBUI_PORT}','profile=any','enable=yes')
$p = Start-Process -FilePath netsh -ArgumentList $fwArgs -Verb RunAs -Wait -PassThru
exit $p.ExitCode
`;
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 60000 },
    );
  } catch (err) {
    throw new Error(
      `ファイアウォールルールの追加に失敗しました（UAC の確認をキャンセルした可能性があります）: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { alreadyExists: false, port: WEBUI_PORT };
}

async function startControlServer() {
  if (controlServer) return;
  const server = createControlServer({
    onRestartWebui: () => restartWeb(),
    onRestartOpencode: () => restartOpencode(),
    onRestartAll: () => restartServices(),
    onStopWebui: () => stopWebForBuild(),
    onVoiceInput: () => launchWindowsVoiceInput(),
    onGetLogs: (since) => getLogEntries(since),
    onAllowFirewall: () => allowFirewallPort(),
    authStore: {
      listUsers,
      verifyUser,
      upsertUser,
      deleteUser,
      hasUsers,
      isAdmin,
      readConfig: readAuthConfig,
      writeConfig: writeAuthConfig,
      windowsAuthSupported: process.platform === 'win32',
      verifyWindowsUser: (username, password) =>
        verifyWindowsCredentials(username, password, {
          onError: (message) => error(`[auth] ${message}`),
        }),
    },
    browserConfig: { read: readBrowserConfig, write: writeBrowserConfig, isAdmin },
    sessionSecret: CONTROL_SECRET,
    trustedDeviceStore: createTrustedDeviceStore(),
    controlPort: CONTROL_PORT,
    // Persisted so a host restart does not hand a brute-force attempt a fresh
    // budget. Two separate windows: per-account (protects the Windows lockout
    // counter) and per-source-address (stops walking the account list).
    loginThrottle: createLoginThrottle({
      store: createThrottleStore({ file: join(DATA_DIR, 'login-throttle.json') }),
    }),
    ipThrottle: createLoginThrottle({
      maxAttempts: 20,
      store: createThrottleStore({ file: join(DATA_DIR, 'login-throttle-ip.json') }),
    }),
  });
  try {
    await listenControlServer(server, CONTROL_PORT);
  } catch (err) {
    server.close();
    throw new Error(
      `Host control port ${CONTROL_PORT} is unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  controlServer = server;
  writeControlFile();
  log(`Host control listening on ${CONTROL_URL}`);
}

async function startBrowserBridgeBroker() {
  if (browserBridgeBroker) return;
  const broker = createBrowserBridgeBroker({
    internalToken: randomBytes(32).toString('base64url'),
    WebSocketServer,
    persistedPairing: loadBrowserBridgePairing(),
    onPairingChanged: (value) => {
      try { saveBrowserBridgePairing(value); } catch (err) {
        error(`Browser Bridge pairing state was not saved: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
  await broker.listen(BROWSER_BRIDGE_PORT);
  browserBridgeBroker = broker;
  log(`Browser Bridge Broker listening on ${broker.url}`);
}

async function closeBrowserBridgeBroker() {
  if (!browserBridgeBroker) return;
  const broker = browserBridgeBroker;
  browserBridgeBroker = null;
  await broker.close();
}

async function quit() {
  if (quitting) return;
  quitting = true;
  log('Shutting down…');
  if (trayStableTimer) {
    clearTimeout(trayStableTimer);
    trayStableTimer = null;
  }
  try {
    await stopChildren();
    await closeBrowserBridgeBroker();
    await closeControlServer(controlServer);
    controlServer = null;
    removeControlFile();
  } finally {
    // Guarantee lock release even if shutdown throws. The 'exit' handler skips
    // when `quitting` is true (to avoid a redundant lock removal), so quit()
    // itself must always drop the lock — otherwise a failed quit() would leave
    // a stale one. A rejection still propagates, preserving the exit(1) path.
    removeLock();
  }
  try {
    if (systray) {
      await systray.kill(false);
    }
  } catch {
    // best effort — exit regardless
  }
  process.exit(0);
}

/**
 * Best-effort synchronous WebUI cleanup for an unexpected host exit (crash,
 * uncaught exception, external kill). Node's 'exit' handler cannot run async
 * work, so this only uses synchronous kills.
 *
 * It runs only while we still own a web child (`webProc.pid`). Once
 * stopChildren/stopWebOnly has run it clears `webProc` (and has already killed
 * the identified listeners); with no owned PID the resolver would fall back to
 * unfiltered listeners, which could kill an unrelated app — so we skip instead.
 * While `webProc` is set we stop its tree plus any port listener identified as
 * our own `next start`, so an orphaned production WebUI does not keep holding
 * :3000 and block the next build. Never throws.
 */
function stopWebTreeOnExit() {
  if (!webProc?.pid) return;
  try {
    const listeningPids = getListeningPids(WEBUI_PORT);
    const killed = stopWebTreeSync({
      ownedPid: webProc.pid,
      listeningPids,
      // One batched command-line query for all listeners (not one spawn per
      // PID); a listener that cannot be identified is left alone.
      isOwnedListener: makeOwnedWebListenerPredicate(listeningPids),
      hardKill: hardKillTree,
    });
    if (killed.length > 0) {
      log(`Exit cleanup stopped WebUI process(es): ${killed.join(', ')}`);
    }
  } catch {
    // best effort — never throw from an exit handler
  }
}

/**
 * 'exit' handler.
 * - Normal quit(): `quitting` is true and quit() has already stopped the
 *   children and removed the lock — return early so we neither re-sweep nor
 *   double-remove the lock.
 * - Unexpected exit (crash / uncaught exception / external kill): `quitting` is
 *   false — best-effort synchronous WebUI sweep, then drop our lock so the next
 *   start does not see a stale one. Children are stopped before releasing the
 *   lock, mirroring quit()'s ordering.
 */
function onHostExit() {
  if (quitting) return;
  stopWebTreeOnExit();
  removeLock();
}

function buildTrayMenu() {
  return {
    icon: TRAY_ICON,
    title: 'OpenCode WebUI',
    tooltip: 'OpenCode WebUI Host',
    items: [
      {
        title: 'Open browser',
        tooltip: `Open ${WEBUI_URL}`,
        checked: false,
        enabled: true,
        click: () => {
          void resolveBrowserUrl().then((url) => openBrowser(url));
        },
      },
      SysTray.separator,
      {
        title: 'Status',
        tooltip: 'Service status',
        checked: false,
        enabled: true,
        items: CADDY_ENABLED
          ? [statusOpencodeItem, statusWebuiItem, statusCaddyItem]
          : [statusOpencodeItem, statusWebuiItem],
      },
      {
        title: 'Restart WebUI',
        tooltip: 'Restart Next.js frontend only',
        checked: false,
        enabled: true,
        click: () => {
          restartWeb().catch((err) => {
            error(err instanceof Error ? err.message : String(err));
          });
        },
      },
      {
        title: 'Restart OpenCode',
        tooltip: 'Restart OpenCode CLI backend only',
        checked: false,
        enabled: true,
        click: () => {
          restartOpencode().catch((err) => {
            error(err instanceof Error ? err.message : String(err));
          });
        },
      },
      {
        title: 'Restart all',
        tooltip: 'Restart OpenCode and WebUI',
        checked: false,
        enabled: true,
        click: () => {
          restartServices().catch((err) => {
            error(err instanceof Error ? err.message : String(err));
          });
        },
      },
      SysTray.separator,
      {
        title: 'Quit',
        tooltip: 'Stop services and exit',
        checked: false,
        enabled: true,
        click: () => {
          quit().catch((err) => {
            error(err instanceof Error ? err.message : String(err));
          });
        },
      },
    ],
  };
}

/** Wire error/exit handlers so a dead tray helper is logged and recreated. */
function wireTrayLifecycle() {
  if (!systray) return;

  systray.onError?.((err) => {
    error(`Tray process error: ${err instanceof Error ? err.message : String(err)}`);
  });

  // systray2 never reads the helper's stderr itself (only stdout, via its own
  // readline for the IPC protocol), so a native tray_windows*.exe crash reason
  // (e.g. a Win32 API failure on locked-down/VDI/RDP sessions) was silently
  // discarded. Surface it so `Tray helper exited unexpectedly (code=...)` has
  // an accompanying message instead of just an exit code.
  systray.process?.stderr?.on('data', (chunk) => {
    error(`Tray helper stderr: ${chunk.toString().trim()}`);
  });

  // Consider the tray "stable" after 60s alive → reset the restart budget.
  if (trayStableTimer) clearTimeout(trayStableTimer);
  trayStableTimer = setTimeout(() => {
    trayRestarts = 0;
  }, 60000);
  trayStableTimer.unref?.();

  systray.process?.on('exit', (code, signal) => {
    if (trayStableTimer) {
      clearTimeout(trayStableTimer);
      trayStableTimer = null;
    }
    // Drop the reference so refreshStatusMenu stops pushing to the dead helper
    // until scheduleTrayRestart installs a fresh one.
    systray = null;
    if (quitting) return;
    error(
      `Tray helper exited unexpectedly (code=${code}, signal=${signal ?? 'none'}); restoring icon`,
    );
    scheduleTrayRestart();
  });
}

/**
 * Create the tray icon. Prefer running the helper from a local cache (copyDir)
 * so a OneDrive-synced/dehydrated repo path can't break or hide the icon;
 * fall back to running it in place if the copy fails.
 */
async function startTray() {
  let lastErr;
  for (const copyDir of [true, false]) {
    try {
      systray = new SysTray({
        menu: buildTrayMenu(),
        debug: false,
        copyDir,
      });
      systray.onClick((action) => {
        if (action.item?.click) {
          action.item.click();
        }
      });
      await systray.ready();
      log(`Tray host ready (copyDir=${copyDir})`);
      wireTrayLifecycle();
      return;
    } catch (err) {
      lastErr = err;
      error(
        `Tray start failed (copyDir=${copyDir}): ${err instanceof Error ? err.message : String(err)}`,
      );
      try {
        await systray?.kill(false);
      } catch {
        // best effort
      }
      systray = null;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function scheduleTrayRestart() {
  if (quitting) return;
  if (trayRestarts >= MAX_TRAY_RESTARTS) {
    error(
      `Tray restart limit reached (${MAX_TRAY_RESTARTS}); continuing without a tray icon`,
    );
    return;
  }
  trayRestarts += 1;
  const delay = Math.min(1000 * trayRestarts, 5000);
  log(`Recreating tray in ${delay}ms (attempt ${trayRestarts}/${MAX_TRAY_RESTARTS})…`);
  setTimeout(() => {
    startTray()
      .then(() => refreshStatusMenu())
      .catch((err) => {
        error(`Tray recreate failed: ${err instanceof Error ? err.message : String(err)}`);
        scheduleTrayRestart();
      });
  }, delay);
}

async function main() {
  if (process.platform !== 'win32') {
    error('This host is intended for Windows.');
    process.exit(1);
  }
  if (webRestartTimer) {
    clearTimeout(webRestartTimer);
    webRestartTimer = null;
  }
  if (webStableTimer) {
    clearTimeout(webStableTimer);
    webStableTimer = null;
  }

  ensureDataDir();
  await acquireLock();

  // Write a header line to the disk log so each host run is identifiable in
  // post-mortem analysis (version / PID / start time / mode). Goes through the
  // writer's writeRaw so it is not also pushed into the ring buffer.
  writeLogFileHeader();

  process.on('SIGINT', () => {
    quit().catch(() => process.exit(1));
  });
  process.on('SIGTERM', () => {
    quit().catch(() => process.exit(1));
  });
  process.on('exit', onHostExit);

  try {
    await startControlServer();
    try {
      await startBrowserBridgeBroker();
    } catch (err) {
      error(
        `Browser Bridge Broker is disabled: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await startChildren();
  } catch (err) {
    await stopChildren();
    await closeBrowserBridgeBroker();
    await closeControlServer(controlServer);
    controlServer = null;
    removeControlFile();
    removeLock();
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Keep monitoring even while the initial readiness wait is in progress.
  // The watchdog has a startup grace period so slow production launches are
  // not mistaken for hangs.
  startWebWatchdog();

  const headless = isHeadless();

  if (headless) {
    log('Headless mode (no tray). Ctrl+C to quit.');
    setInterval(() => {
      refreshStatusMenu().catch(() => {});
    }, 5000);
    const browserUrl = startResolvingBrowserUrl();
    const webReady = await waitUntilReady(WEBUI_URL, 'WebUI', 60, {
      proc: () => webProc,
    });
    await waitUntilReady(`${OPENCODE_URL}/global/health`, 'OpenCode', 60, {
      proc: () => opencodeProc,
    });
    if (webReady && browserUrl) {
      openBrowser(await browserUrl);
    }
    return;
  }

  try {
    await startTray();
  } catch (err) {
    removeLock();
    await stopChildren();
    error(`Tray failed to start: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  setInterval(() => {
    refreshStatusMenu().catch(() => {});
  }, 5000);
  await refreshStatusMenu();
  const browserUrl = startResolvingBrowserUrl();
  const webReady = await waitUntilReady(WEBUI_URL, 'WebUI', 60, {
    proc: () => webProc,
  });
  await waitUntilReady(`${OPENCODE_URL}/global/health`, 'OpenCode', 60, {
    proc: () => opencodeProc,
  });
  if (webReady && browserUrl) {
    openBrowser(await browserUrl);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    removeLock();
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
