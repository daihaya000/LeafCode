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
const WEBUI_PORT = 3000;
const WEBUI_URL = `http://127.0.0.1:${WEBUI_PORT}`;
const OPENCODE_URL = `http://127.0.0.1:${OPENCODE_PORT}`;

const iconData = JSON.parse(readFileSync(join(__dirname, 'icon.json'), 'utf8'));
const TRAY_ICON = iconData.base64;

/** @type {import('child_process').ChildProcess | null} */
let opencodeProc = null;
/** @type {import('child_process').ChildProcess | null} */
let webProc = null;
/** @type {import('systray2').default | null} */
let systray = null;
let quitting = false;

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

function spawnWeb() {
  const hasBuild = existsSync(join(WEB_DIR, '.next', 'BUILD_ID'));
  const useProd =
    process.env.OPENCODE_WEBUI_MODE === 'prod' ||
    (process.env.OPENCODE_WEBUI_MODE !== 'dev' && hasBuild);

  const npmArgs = useProd
    ? ['run', 'start', '--', '--hostname', '127.0.0.1', '--port', String(WEBUI_PORT)]
    : ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', String(WEBUI_PORT)];

  log(`Starting WebUI (${useProd ? 'production' : 'dev'}) in ${WEB_DIR}`);
  // On Windows, npm is a .cmd shim — must use shell:true
  webProc = spawn('npm', npmArgs, {
    cwd: WEB_DIR,
    shell: true,
    stdio: 'pipe',
    windowsHide: true,
    env: process.env,
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
  await refreshStatusMenu();
}

function stopChildren() {
  const pids = [opencodeProc?.pid, webProc?.pid].filter(Boolean);
  for (const pid of pids) {
    killProcessTree(pid);
  }
  opencodeProc = null;
  webProc = null;
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
  stopChildren();
  removeLock();
  if (systray) {
    systray.kill(false);
  } else {
    process.exit(0);
  }
}

function createTray() {
  systray = new SysTray({
    menu: {
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
          items: [statusOpencodeItem, statusWebuiItem],
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
    },
    debug: false,
    copyDir: false,
  });

  systray.onClick((action) => {
    if (action.item?.click) {
      action.item.click();
    }
  });
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

  createTray();

  systray
    .ready()
    .then(async () => {
      log('Tray host ready');
      setInterval(() => {
        refreshStatusMenu().catch(() => {});
      }, 5000);
      await refreshStatusMenu();
      const webReady = await waitUntilReady(WEBUI_URL, 'WebUI');
      await waitUntilReady(`${OPENCODE_URL}/global/health`, 'OpenCode');
      if (webReady && process.env.OPENCODE_WEBUI_NO_BROWSER !== '1') {
        openBrowser(WEBUI_URL);
      }
    })
    .catch((err) => {
      removeLock();
      stopChildren();
      error(`Tray failed to start: ${err.message}`);
      process.exit(1);
    });
}

main().catch((err) => {
  removeLock();
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
