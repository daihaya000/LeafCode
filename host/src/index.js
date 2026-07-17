import { spawn, execFileSync, execSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  unlinkSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import SysTrayImport from 'systray2';
import { formatServiceStatus } from './service-status.js';
import { getWebLaunchPlan, webRestartDelay } from './web-runtime.js';

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
const LOCK_FILE = join(DATA_DIR, 'host.lock');
const OPENCODE_PORT = 4096;
const WEBUI_PORT = Number(process.env.OPENCODE_WEBUI_PORT) || 3000;
/** Bind address for Next.js. Default 0.0.0.0 so VPN/LAN phone can reach it.
 *  OpenCode engine stays on 127.0.0.1. Override with OPENCODE_WEBUI_HOST=127.0.0.1 for local-only. */
const WEBUI_HOST = process.env.OPENCODE_WEBUI_HOST || '0.0.0.0';
const WEBUI_URL = `http://127.0.0.1:${WEBUI_PORT}`;
const OPENCODE_URL = `http://127.0.0.1:${OPENCODE_PORT}`;

/** Optional Caddy reverse proxy (TLS / remote). Enable with OPENCODE_WEBUI_CADDY=1.
 *  Caddyfile path defaults to deploy/Caddyfile (auto-created from the example). */
const CADDY_ENABLED = process.env.OPENCODE_WEBUI_CADDY === '1';
const CADDYFILE =
  process.env.OPENCODE_WEBUI_CADDYFILE || join(REPO_ROOT, 'deploy', 'Caddyfile');
const CADDYFILE_EXAMPLE = join(REPO_ROOT, 'deploy', 'Caddyfile.example');

const iconData = JSON.parse(readFileSync(join(__dirname, 'icon.json'), 'utf8'));
const TRAY_ICON = iconData.base64;

/** @type {import('child_process').ChildProcess | null} */
let opencodeProc = null;
/** @type {import('child_process').ChildProcess | null} */
let webProc = null;
/** @type {import('child_process').ChildProcess | null} */
let webBuildProc = null;
/** @type {import('child_process').ChildProcess | null} */
let caddyProc = null;
/** @type {import('systray2').default | null} */
let systray = null;
let quitting = false;
let restartingServices = false;

/** WebUI self-healing. Expected exits (manual restart/quit) never consume it. */
const MAX_WEB_RESTARTS = 5;
let webRestarts = 0;
/** @type {NodeJS.Timeout | null} */
let webRestartTimer = null;
/** @type {NodeJS.Timeout | null} */
let webStableTimer = null;
const expectedWebExitPids = new Set();

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

function log(message) {
  console.log(`[opencode-webui-host] ${message}`);
}

function error(message) {
  console.error(`[opencode-webui-host] ${message}`);
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

/** Run Windows PowerShell without routing the command through cmd.exe quoting. */
function runPowerShell(command) {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortInUse(port) {
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return /LISTENING/.test(output);
  } catch {
    return false;
  }
}

function killProcessTree(pid) {
  if (!pid) return;
  try {
    execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' });
  } catch {
    // already exited
  }
}

function openBrowser(url) {
  spawn('cmd', ['/c', 'start', '', url], {
    detached: true,
    stdio: 'ignore',
    shell: false,
  }).unref();
}

function findOpencode() {
  try {
    const output = execSync('where.exe opencode', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = output
      .trim()
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    // Prefer real binary over npm shim (.cmd / extensionless)
    const exe = lines.find((p) => /\.exe$/i.test(p));
    if (exe) return exe;

    const cmd = lines.find((p) => /\.cmd$/i.test(p));
    if (cmd) {
      const siblingExe = join(
        dirname(cmd),
        'node_modules',
        'opencode-ai',
        'bin',
        'opencode.exe',
      );
      if (existsSync(siblingExe)) return siblingExe;
      return cmd;
    }

    if (lines[0]) {
      const siblingExe = join(
        dirname(lines[0]),
        'node_modules',
        'opencode-ai',
        'bin',
        'opencode.exe',
      );
      if (existsSync(siblingExe)) return siblingExe;
      return lines[0];
    }
    throw new Error('empty where.exe result');
  } catch (err) {
    if (err instanceof Error && err.message.includes('opencode not found')) {
      throw err;
    }
    throw new Error('opencode not found on PATH. Install OpenCode CLI first.');
  }
}

function spawnOpencode(opencodePath) {
  const useShell = /\.(cmd|bat)$/i.test(opencodePath);
  opencodeProc = spawn(
    opencodePath,
    ['serve', '--hostname', '127.0.0.1', '--port', String(OPENCODE_PORT)],
    {
      cwd: REPO_ROOT,
      shell: useShell,
      stdio: 'pipe',
      windowsHide: true,
    },
  );

  opencodeProc.on('error', (err) => {
    error(`OpenCode spawn error: ${err.message}`);
  });

  opencodeProc.stdout?.on('data', (chunk) => {
    process.stdout.write(`[opencode] ${chunk}`);
  });
  opencodeProc.stderr?.on('data', (chunk) => {
    process.stderr.write(`[opencode] ${chunk}`);
  });
  opencodeProc.on('exit', (code, signal) => {
    if (!quitting) {
      log(`OpenCode exited (code=${code}, signal=${signal ?? 'none'})`);
    }
    opencodeProc = null;
    refreshStatusMenu();
  });
}

function findCaddy() {
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

/** Ensure a Caddyfile exists, seeding from the bundled example on first run. */
function ensureCaddyfile() {
  if (existsSync(CADDYFILE)) return true;
  try {
    if (existsSync(CADDYFILE_EXAMPLE)) {
      writeFileSync(CADDYFILE, readFileSync(CADDYFILE_EXAMPLE, 'utf8'), 'utf8');
      log(`Created ${CADDYFILE} from example — edit domain/auth before remote use`);
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
  });
  caddyProc.stderr?.on('data', (chunk) => {
    process.stderr.write(`[caddy] ${chunk}`);
  });
  caddyProc.on('exit', (code, signal) => {
    if (!quitting) {
      log(`Caddy exited (code=${code}, signal=${signal ?? 'none'})`);
    }
    caddyProc = null;
    refreshStatusMenu();
  });
}

/**
 * Stop any stray Caddy left behind when taking over a degraded host. That host
 * is killed without /T so its OpenCode/WebUI can be reused via health check, but
 * Caddy has no port-reuse path in resolvePortPlan and still holds its ports —
 * a fresh spawnCaddy() would fail to bind and orphan the old process. Only used
 * on the abnormal takeover path, and only when this host manages Caddy.
 */
function stopStrayCaddy() {
  try {
    execSync('taskkill /F /IM caddy.exe', { stdio: 'ignore' });
    log('Stopped orphaned Caddy from the degraded host before takeover');
  } catch {
    // No stray Caddy running (taskkill exits non-zero when none matched).
  }
}

function removeBrokenWebBuild() {
  const buildDir = join(WEB_DIR, '.next');
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

/** Build the production WebUI when prod mode has no usable BUILD_ID. */
function buildWebProduction() {
  return new Promise((resolve, reject) => {
    removeBrokenWebBuild();
    log('Production WebUI build is missing; rebuilding before start…');
    const child = spawnNpm(['run', 'build'], {
      cwd: WEB_DIR,
      stdio: 'pipe',
      windowsHide: true,
      env: {
        ...process.env,
        NEXT_DIST_DIR: '.next',
      },
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
    });
    child.stderr?.on('data', (chunk) => {
      process.stderr.write(`[web-build] ${chunk}`);
    });
    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      if (code !== 0) {
        finish(new Error(`WebUI production build failed (code=${code})`));
        return;
      }
      if (!existsSync(join(WEB_DIR, '.next', 'BUILD_ID'))) {
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
    if (webProc === child && procRunning(child)) webRestarts = 0;
  }, 60000);
  webStableTimer.unref?.();
}

async function spawnWeb() {
  let hasBuild = existsSync(join(WEB_DIR, '.next', 'BUILD_ID'));
  let plan = getWebLaunchPlan(process.env.OPENCODE_WEBUI_MODE, hasBuild);
  if (plan.needsBuild) {
    await buildWebProduction();
    hasBuild = existsSync(join(WEB_DIR, '.next', 'BUILD_ID'));
    plan = getWebLaunchPlan(process.env.OPENCODE_WEBUI_MODE, hasBuild);
  }
  if (plan.needsBuild) throw new Error('WebUI production build is unavailable');
  const useProd = plan.useProd;

  const npmArgs = useProd
    ? ['run', 'start', '--', '--hostname', WEBUI_HOST, '--port', String(WEBUI_PORT)]
    : ['run', 'dev', '--', '--hostname', WEBUI_HOST, '--port', String(WEBUI_PORT)];

  log(
    `Starting WebUI (${useProd ? 'production' : 'dev'}) on ${WEBUI_HOST}:${WEBUI_PORT} in ${WEB_DIR}`,
  );
  const child = spawnNpm(npmArgs, {
    cwd: WEB_DIR,
    stdio: 'pipe',
    windowsHide: true,
    env: {
      ...process.env,
      OPENCODE_WEBUI_HOST: WEBUI_HOST,
      OPENCODE_WEBUI_PORT: String(WEBUI_PORT),
      PORT: String(WEBUI_PORT),
    },
  });
  webProc = child;
  armWebStableReset(child);

  child.on('error', (err) => {
    error(`WebUI spawn error: ${err.message}`);
  });

  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`[webui] ${chunk}`);
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[webui] ${chunk}`);
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

function scheduleWebRestart() {
  if (quitting || webRestartTimer || procRunning(webProc)) return;
  if (webRestarts >= MAX_WEB_RESTARTS) {
    error(`WebUI restart limit reached (${MAX_WEB_RESTARTS})`);
    return;
  }
  webRestarts += 1;
  const delay = webRestartDelay(webRestarts);
  log(`Restarting WebUI in ${delay}ms (attempt ${webRestarts}/${MAX_WEB_RESTARTS})…`);
  webRestartTimer = setTimeout(() => {
    webRestartTimer = null;
    void (async () => {
      if (quitting || procRunning(webProc)) return;
      if (await isHttpUp(WEBUI_URL)) {
        webRestarts = 0;
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

function writeLock() {
  const created = getProcessCreationTime(process.pid);
  writeFileSync(
    LOCK_FILE,
    JSON.stringify({ pid: process.pid, created }),
    { encoding: 'utf8', flag: 'wx' },
  );
}

function removeLock() {
  if (!existsSync(LOCK_FILE)) return;
  try {
    const lockPid = readLockPid();
    if (lockPid === process.pid) {
      unlinkSync(LOCK_FILE);
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
  if (lock.created) {
    const created = getProcessCreationTime(lockPid);
    if (created && created !== lock.created) {
      removeStaleLock(`PID reused by another process (created=${created})`);
      return false;
    }
    if (created === lock.created) {
      hostIdentityVerified = true;
    } else {
      const cmdline = getProcessCommandLine(lockPid);
      if (cmdline && !looksLikeHostCommandLine(cmdline)) {
        removeStaleLock(`PID reused by another process (${cmdline})`);
        return false;
      }
      if (cmdline) hostIdentityVerified = true;
      if (!cmdline) {
        log(`Could not verify identity of live lock PID ${lockPid}; preserving it`);
      }
    }
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
  const headless = process.env.OPENCODE_WEBUI_HEADLESS === '1';
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

  if (process.env.OPENCODE_WEBUI_NO_BROWSER !== '1') {
    log(`Host already running (PID ${lockPid}). Opening ${WEBUI_URL}`);
    openBrowser(WEBUI_URL);
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

async function resolvePortPlan() {
  const plan = { startOpencode: true, startWeb: true };

  if (isPortInUse(OPENCODE_PORT)) {
    const healthy = await isHttpUp(`${OPENCODE_URL}/global/health`);
    if (healthy) {
      log(`Reusing existing OpenCode on :${OPENCODE_PORT}`);
      plan.startOpencode = false;
    } else {
      throw new Error(
        `Port ${OPENCODE_PORT} is in use but OpenCode health check failed. Free the port and retry.`,
      );
    }
  }

  if (isPortInUse(WEBUI_PORT)) {
    const healthy = await isHttpUp(WEBUI_URL);
    if (healthy) {
      log(`Reusing existing WebUI on :${WEBUI_PORT}`);
      plan.startWeb = false;
    } else {
      throw new Error(
        `Port ${WEBUI_PORT} is in use but WebUI is not responding. Free the port and retry.`,
      );
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

async function waitUntilReady(url, label, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    if (await isHttpUp(url)) {
      log(`${label} is ready`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  error(`${label} did not become ready in time (${url})`);
  return false;
}

function procRunning(proc) {
  return proc != null && proc.exitCode == null && !proc.killed;
}

async function startChildren() {
  const plan = await resolvePortPlan();
  if (plan.startOpencode) {
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

function stopChildren() {
  if (webRestartTimer) {
    clearTimeout(webRestartTimer);
    webRestartTimer = null;
  }
  if (webStableTimer) {
    clearTimeout(webStableTimer);
    webStableTimer = null;
  }
  webRestarts = 0;
  if (webProc?.pid) expectedWebExitPids.add(webProc.pid);
  const pids = [
    opencodeProc?.pid,
    webProc?.pid,
    webBuildProc?.pid,
    caddyProc?.pid,
  ].filter(Boolean);
  for (const pid of pids) {
    killProcessTree(pid);
  }
  opencodeProc = null;
  webProc = null;
  webBuildProc = null;
  caddyProc = null;
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

  if (systray) {
    systray.sendAction({ type: 'update-item', item: statusOpencodeItem });
    systray.sendAction({ type: 'update-item', item: statusWebuiItem });
  }

  if (CADDY_ENABLED) {
    statusCaddyItem.title = procRunning(caddyProc)
      ? 'Caddy: running'
      : 'Caddy: stopped';
    if (systray) {
      systray.sendAction({ type: 'update-item', item: statusCaddyItem });
    }
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
    stopChildren();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await startChildren();
  } catch (err) {
    stopChildren();
    throw err;
  } finally {
    restartingServices = false;
    await refreshStatusMenu();
  }
}

async function quit() {
  if (quitting) return;
  quitting = true;
  log('Shutting down…');
  if (trayStableTimer) {
    clearTimeout(trayStableTimer);
    trayStableTimer = null;
  }
  stopChildren();
  removeLock();
  try {
    if (systray) {
      await systray.kill(false);
    }
  } catch {
    // best effort — exit regardless
  }
  process.exit(0);
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
        click: () => openBrowser(WEBUI_URL),
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
        title: 'Restart',
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

  process.on('SIGINT', () => {
    quit().catch(() => process.exit(1));
  });
  process.on('SIGTERM', () => {
    quit().catch(() => process.exit(1));
  });
  process.on('exit', removeLock);

  try {
    await startChildren();
  } catch (err) {
    stopChildren();
    removeLock();
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const headless = process.env.OPENCODE_WEBUI_HEADLESS === '1';

  if (headless) {
    log('Headless mode (no tray). Ctrl+C to quit.');
    setInterval(() => {
      refreshStatusMenu().catch(() => {});
    }, 5000);
    const webReady = await waitUntilReady(WEBUI_URL, 'WebUI');
    await waitUntilReady(`${OPENCODE_URL}/global/health`, 'OpenCode');
    if (webReady && process.env.OPENCODE_WEBUI_NO_BROWSER !== '1') {
      openBrowser(WEBUI_URL);
    }
    return;
  }

  try {
    await startTray();
  } catch (err) {
    removeLock();
    stopChildren();
    error(`Tray failed to start: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  setInterval(() => {
    refreshStatusMenu().catch(() => {});
  }, 5000);
  await refreshStatusMenu();
  const webReady = await waitUntilReady(WEBUI_URL, 'WebUI');
  await waitUntilReady(`${OPENCODE_URL}/global/health`, 'OpenCode');
  if (webReady && process.env.OPENCODE_WEBUI_NO_BROWSER !== '1') {
    openBrowser(WEBUI_URL);
  }
}

main().catch((err) => {
  removeLock();
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
