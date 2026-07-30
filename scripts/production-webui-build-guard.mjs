import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultWebDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "web");
const DEFAULT_CONTROL_URL = "http://127.0.0.1:18765";

export function parseListeningPids(output, port) {
  const pids = new Set();
  const portSuffix = `:${port}`;
  for (const line of String(output).split(/\r?\n/)) {
    if (!/\bLISTENING\b/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const localAddress = parts[1] ?? "";
    const pid = Number(parts.at(-1));
    if (
      Number.isFinite(pid) &&
      pid > 0 &&
      (localAddress.endsWith(portSuffix) || localAddress.endsWith(`]${portSuffix}`))
    ) {
      pids.add(pid);
    }
  }
  return [...pids];
}

export function isThisWebUiNextStart(commandLine, webDir) {
  const command = String(commandLine).replaceAll("/", "\\").toLowerCase();
  const expectedWebDir = resolve(webDir).replaceAll("/", "\\").toLowerCase();
  const isNextStart = /(?:^|[\\\s"])(?:next|next\.js)["\s]+start(?:\s|$)/i.test(command);
  return command.includes(expectedWebDir) && isNextStart;
}

export function inspectProductionWebUi({
  port = 3000,
  webDir = defaultWebDir,
  exec = execFileSync,
} = {}) {
  let pids;
  try {
    pids = parseListeningPids(exec("netstat", ["-ano"], { encoding: "utf8" }), port);
  } catch {
    return { state: "unknown" };
  }
  if (pids.length === 0) return { state: "absent" };

  for (const pid of pids) {
    let commandLine;
    try {
      commandLine = exec(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\" | Select-Object -ExpandProperty CommandLine`,
        ],
        { encoding: "utf8" },
      );
    } catch {
      // A listener whose identity cannot be established might be our Next
      // server. Fail closed rather than risk replacing its .next generation.
      return { state: "unknown", pid };
    }
    if (isThisWebUiNextStart(commandLine, webDir)) return { state: "running", pid };
  }
  return { state: "absent" };
}

function webUiPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 3000;
}

const defaultSleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Resolve the tray host's localhost control-plane base URL.
 * env → %APPDATA%\opencode-webui\host-control.json → default port.
 */
export function resolveHostControlUrl({
  env = process.env,
  exists = existsSync,
  read = readFileSync,
} = {}) {
  const fromEnv = env.OPENCODE_WEBUI_HOST_CONTROL_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  const appData = env.APPDATA;
  if (appData) {
    const file = join(appData, "opencode-webui", "host-control.json");
    if (exists(file)) {
      try {
        const data = JSON.parse(read(file, "utf8"));
        if (typeof data.url === "string" && data.url.trim()) {
          return data.url.trim().replace(/\/+$/, "");
        }
        if (typeof data.port === "number" && Number.isFinite(data.port)) {
          return `http://127.0.0.1:${data.port}`;
        }
      } catch {
        // fall through to the default
      }
    }
  }

  return DEFAULT_CONTROL_URL;
}

async function hostControlIsHealthy(controlUrl, doFetch, timeoutMs) {
  try {
    const res = await doFetch(`${controlUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res?.ok) return false;
    if (typeof res.json !== "function") return true;
    try {
      const body = await res.json();
      // Someone else may hold the control port; only our host may be trusted
      // to stop the WebUI. Unrecognised bodies fall through to /stop/webui,
      // which fails closed with host-outdated.
      if (body && typeof body.service === "string") {
        return body.service === "opencode-webui-host";
      }
    } catch {
      // Not JSON — let /stop/webui decide.
    }
    return true;
  } catch {
    return false;
  }
}

async function waitForAbsent(inspect, options, sleep, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (inspect(options).state === "absent") return true;
    if (Date.now() >= deadline) return false;
    await sleep(pollMs);
  }
}

/**
 * Ask the tray host to stop the production WebUI so the build can replace
 * web/.next, falling back to a targeted kill only for an orphaned `next start`.
 *
 * @returns {Promise<{ stopped: boolean, method?: string, reason?: string, pid?: number }>}
 */
export async function stopProductionWebUi({
  port = 3000,
  webDir = defaultWebDir,
  controlUrl,
  fetchImpl = globalThis.fetch,
  inspect = inspectProductionWebUi,
  exec = execFileSync,
  sleep = defaultSleep,
  env = process.env,
  healthTimeoutMs = 2000,
  stopTimeoutMs = 60000,
  portWaitMs = 15000,
  pollMs = 250,
  softKillWaitMs = 3000,
} = {}) {
  const inspectOptions = { port, webDir, exec };
  const baseUrl = (controlUrl ?? resolveHostControlUrl({ env })).replace(/\/+$/, "");

  if (await hostControlIsHealthy(baseUrl, fetchImpl, healthTimeoutMs)) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/stop/webui`, {
        method: "POST",
        signal: AbortSignal.timeout(stopTimeoutMs),
      });
    } catch {
      return { stopped: false, reason: "host-control-failed" };
    }

    // The host is alive but has no stop endpoint (pre-feature build). Killing
    // would be undone by its watchdog, which would then rebuild/serve on top of
    // the build — refuse instead of falling back to kill.
    if (res.status === 404 || res.status === 501) {
      return { stopped: false, reason: "host-outdated" };
    }
    if (!res.ok) return { stopped: false, reason: "host-control-failed" };

    const free = await waitForAbsent(inspect, inspectOptions, sleep, portWaitMs, pollMs);
    return free
      ? { stopped: true, method: "host-control" }
      : { stopped: false, reason: "host-control-failed" };
  }

  // No control plane: an orphaned `next start` nobody will respawn. Only a
  // listener positively identified as this repo's `next start` is killed.
  const target = inspect(inspectOptions);
  if (target.state === "absent") return { stopped: true, method: "already-stopped" };
  if (target.state !== "running") return { stopped: false, reason: "unidentified-listener" };

  const pid = target.pid;
  try {
    exec("taskkill", ["/T", "/PID", String(pid)], { encoding: "utf8", stdio: "ignore" });
  } catch {
    // The process may already be gone, or need /F below.
  }
  if (!(await waitForAbsent(inspect, inspectOptions, sleep, softKillWaitMs, pollMs))) {
    try {
      exec("taskkill", ["/T", "/F", "/PID", String(pid)], { encoding: "utf8", stdio: "ignore" });
    } catch {
      // Fall through to the port check: the kill may still have succeeded.
    }
    if (!(await waitForAbsent(inspect, inspectOptions, sleep, portWaitMs, pollMs))) {
      return { stopped: false, reason: "kill-failed", pid };
    }
  }
  return { stopped: true, method: "kill", pid };
}

/**
 * Best-effort "start the WebUI again" request after a successful build.
 * @returns {Promise<boolean>} true when the host accepted the restart
 */
export async function requestHostRestartWebUi({
  controlUrl,
  fetchImpl = globalThis.fetch,
  env = process.env,
  timeoutMs = 5000,
} = {}) {
  const baseUrl = (controlUrl ?? resolveHostControlUrl({ env })).replace(/\/+$/, "");
  try {
    const res = await fetchImpl(`${baseUrl}/restart/webui`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const port = webUiPort(process.env.OPENCODE_WEBUI_PORT);

  // --restart is a no-op now: build.bat no longer stops the WebUI, so there is
  // nothing to restart. Kept for backward compatibility with older build.bat.
  if (argv.includes("--restart")) {
    console.log(
      "[OpenCode WebUI] --restart is a no-op; build.bat no longer stops the WebUI. Start it from the tray or start-webui.bat if needed.",
    );
    return;
  }

  // --stop is ignored: the guard never stops the WebUI. A running production
  // WebUI owns web/.next and building on top of it corrupts the live build, so
  // refuse and tell the user to stop it first. Backward compatibility only.
  if (argv.includes("--stop")) {
    const result = inspectProductionWebUi({ port });
    if (result.state === "absent") return;
    console.error(
      `[OpenCode WebUI] --stop is no longer supported. Stop the running production WebUI (port ${port}) from the tray or start-webui.bat, then re-run build.bat.`,
    );
    process.exitCode = 1;
    return;
  }

  const result = inspectProductionWebUi({ port });
  if (result.state === "absent") return;

  if (result.state === "unknown") {
    console.error(
      `[OpenCode WebUI] A listener on port ${port} could not be identified. Build was cancelled to protect the running production WebUI.`,
    );
    process.exitCode = 1;
    return;
  }

  console.error(
    `[OpenCode WebUI] Production WebUI is running on port ${port} (PID ${result.pid}). Stop it from the tray or start-webui.bat before building.`,
  );
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(
      `[OpenCode WebUI] Production WebUI guard failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  });
}
