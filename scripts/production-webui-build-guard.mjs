import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultWebDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "web");

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

function main() {
  const port = webUiPort(process.env.OPENCODE_WEBUI_PORT);
  const result = inspectProductionWebUi({ port });
  if (result.state === "absent") return;

  if (result.state === "running") {
    console.error(
      `[OpenCode WebUI] Production WebUI is running on port ${port} (PID ${result.pid}). Stop it before building.`,
    );
  } else {
    console.error(
      `[OpenCode WebUI] A listener on port ${port} could not be identified. Build was cancelled to protect the running production WebUI.`,
    );
  }
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
