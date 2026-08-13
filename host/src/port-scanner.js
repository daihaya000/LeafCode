/**
 * Netstat / process identification helpers for the host process
 * (REFACTORING_PLAN P6-a / IMPROVEMENT 4-1: port watching group).
 */
import { execFile, execSync } from 'child_process';
import { promisify } from 'util';
import { parseListeningPids } from './port-plan.js';
// Reuse the build guard's listener identification so the stop path and the
// build guard agree on what counts as "our" production WebUI (never kill an
// unrelated app that happens to occupy the port). Import-safe: the guard only
// runs main() when executed directly.
import { isThisWebUiNextStart } from '../../scripts/production-webui-build-guard.mjs';

const execFileAsync = promisify(execFile);

export function runPowerShell(command) {
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


export function captureNetstat() {
  const output = runNetstat();
  return output == null ? null : { output };
}

export async function captureNetstatAsync() {
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

export function runNetstat() {
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
export function getListeningPids(port, snapshot) {
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
export function getCommandLineMap(pids) {
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
export function makeOwnedWebListenerPredicate(listenerPids, webDir) {
  const commandLines = getCommandLineMap(listenerPids);
  return (pid) => {
    const commandLine = commandLines.get(Number(pid));
    if (!commandLine) return false;
    return isThisWebUiNextStart(commandLine, webDir);
  };
}

export function isPortInUse(port, snapshot) {
  return getListeningPids(port, snapshot).length > 0;
}

/**
 * Scans the candidate range against a single netstat snapshot: the answer is a
 * point-in-time decision anyway, and re-running netstat per candidate cost up
 * to 20 x ~150 ms on the fallback path.
 */
export function findFreePort(startPort, maxAttempts = 20) {
  const snapshot = captureNetstat();
  for (let port = startPort; port < startPort + maxAttempts; port += 1) {
    if (!isPortInUse(port, snapshot)) return port;
  }
  return null;
}

