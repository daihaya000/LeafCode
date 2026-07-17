import { spawn, execSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import SysTrayImport from 'systray2';

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
let caddyProc = null;
/** @type {import('systray2').default | null} */
let systray = null;
let quitting = false;

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

function spawnWeb() {
  const hasBuild = existsSync(join(WEB_DIR, '.next', 'BUILD_ID'));
  const useProd =
    process.env.OPENCODE_WEBUI_MODE === 'prod' ||
    (process.env.OPENCODE_WEBUI_MODE !== 'dev' && hasBuild);

  const npmArgs = useProd
    ? ['run', 'start', '--', '--hostname', WEBUI_HOST, '--port', String(WEBUI_PORT)]
    : ['run', 'dev', '--', '--hostname', WEBUI_HOST, '--port', String(WEBUI_PORT)];

  log(
    `Starting WebUI (${useProd ? 'production' : 'dev'}) on ${WEBUI_HOST}:${WEBUI_PORT} in ${WEB_DIR}`,
  );
  // On Windows, npm is a .cmd shim — must use shell:true
  webProc = spawn('npm', npmArgs, {
    cwd: WEB_DIR,
    shell: true,
    stdio: 'pipe',
    windowsHide: true,
    env: {
      ...process.env,
      OPENCODE_WEBUI_HOST: WEBUI_HOST,
      OPENCODE_WEBUI_PORT: String(WEBUI_PORT),
      PORT: String(WEBUI_PORT),
    },
  });

  webProc.on('error', (err) => {
    error(`WebUI spawn error: ${err.message}`);
  });

  webProc.stdout?.on('data', (chunk) => {
    process.stdout.write(`[webui] ${chunk}`);
  });
  webProc.stderr?.on('data', (chunk) => {
    process.stderr.write(`[webui] ${chunk}`);
  });
  webProc.on('exit', (code, signal) => {
    if (!quitting) {
      log(`WebUI exited (code=${code}, signal=${signal ?? 'none'})`);
    }
    webProc = null;
    refreshStatusMenu();
  });
}

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readLockPid() {
  if (!existsSync(LOCK_FILE)) return null;
  try {
    const raw = readFileSync(LOCK_FILE, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function writeLock() {
  writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
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

function handleExistingInstance() {
  const lockPid = readLockPid();
  if (lockPid == null) return false;

  if (isProcessAlive(lockPid)) {
    log(`Host already running (PID ${lockPid}). Opening ${WEBUI_URL}`);
    openBrowser(WEBUI_URL);
    process.exit(0);
  }

  try {
    unlinkSync(LOCK_FILE);
    log(`Removed stale lock (PID ${lockPid})`);
  } catch {
    // continue
  }
  return false;
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
    spawnWeb();
  }
  if (CADDY_ENABLED) {
    spawnCaddy();
  }
  await refreshStatusMenu();
}

function stopChildren() {
  const pids = [opencodeProc?.pid, webProc?.pid, caddyProc?.pid].filter(Boolean);
  for (const pid of pids) {
    killProcessTree(pid);
  }
  opencodeProc = null;
  webProc = null;
  caddyProc = null;
}

function formatStatus(name, proc, httpUp) {
  if (!procRunning(proc)) return `${name}: stopped`;
  if (httpUp) return `${name}: running`;
  return `${name}: starting…`;
}

async function refreshStatusMenu() {
  const [opencodeUp, webUp] = await Promise.all([
    isHttpUp(`${OPENCODE_URL}/global/health`),
    isHttpUp(WEBUI_URL),
  ]);

  statusOpencodeItem.title = formatStatus('OpenCode', opencodeProc, opencodeUp);
  statusWebuiItem.title = formatStatus('WebUI', webProc, webUp);

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
  log('Restarting services…');
  stopChildren();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    await startChildren();
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
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

  ensureDataDir();
  handleExistingInstance();
  writeLock();

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
