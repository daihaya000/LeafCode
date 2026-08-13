/**
 * Windows-safe process stop helpers.
 *
 * Ghost LISTENING sockets often appear after `taskkill /F` (TerminateProcess)
 * when child processes still hold an inherited listen handle, or when the
 * server never gets to close() the socket. Prefer dispose → soft kill → hard kill.
 */

import { execSync as defaultExecSync } from 'child_process';
import { resolveWebKillPids } from './restart-targets.js';

/**
 * @param {unknown} pid
 * @returns {number | null}
 */
function asPid(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * @param {number} pid
 * @param {{ execSync?: typeof import('child_process').execSync }} [deps]
 */
export function softKillTree(pid, deps = {}) {
  const id = asPid(pid);
  if (!id) return false;
  const run = deps.execSync ?? defaultExecSync;
  try {
    // Without /F: asks the process to close (WM_CLOSE / console break). Gives
    // Bun/Node a chance to release the listen socket before the kernel orphans it.
    run(`taskkill /T /PID ${id}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {number} pid
 * @param {{ execSync?: typeof import('child_process').execSync }} [deps]
 */
export function hardKillTree(pid, deps = {}) {
  const id = asPid(pid);
  if (!id) return false;
  const run = deps.execSync ?? defaultExecSync;
  try {
    run(`taskkill /T /F /PID ${id}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Direct children of `pid` (one level). Used to reap inheritors after a crash.
 * @param {number} pid
 * @param {{ execSync?: typeof import('child_process').execSync }} [deps]
 * @returns {number[]}
 */
export function listChildPids(pid, deps = {}) {
  const id = asPid(pid);
  if (!id) return [];
  const run = deps.execSync ?? defaultExecSync;
  try {
    const output = run(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ParentProcessId=${id}\\").ProcessId"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    return parseChildPidOutput(output);
  } catch {
    return [];
  }
}

/**
 * @param {string} output
 * @returns {number[]}
 */
export function parseChildPidOutput(output) {
  if (!output) return [];
  const ids = [];
  for (const line of String(output).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!/^\d+$/.test(trimmed)) continue;
    const n = Number(trimmed);
    if (Number.isFinite(n) && n > 0) ids.push(n);
  }
  return [...new Set(ids)];
}

/**
 * Build Basic auth headers when OPENCODE_SERVER_PASSWORD is set.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, string>}
 */
export function disposeAuthHeaders(env = process.env) {
  const password = env.OPENCODE_SERVER_PASSWORD;
  if (!password) return {};
  const user = env.OPENCODE_SERVER_USERNAME || 'opencode';
  return {
    Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
  };
}

/**
 * Ask OpenCode to tear down MCP/LSP/instance resources before process kill.
 * Does not exit the serve process, but reduces inherited-handle ghosts.
 * @param {string} baseUrl
 * @param {{ fetch?: typeof fetch, timeoutMs?: number, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<boolean>}
 */
export async function disposeOpencodeServer(baseUrl, opts = {}) {
  if (!baseUrl) return false;
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const headers = disposeAuthHeaders(opts.env);
  try {
    const res = await doFetch(new URL('/global/dispose', baseUrl), {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Soft → wait → hard kill of a process tree.
 * @param {{
 *   pid: number,
 *   softKill?: (pid: number) => boolean,
 *   hardKill?: (pid: number) => boolean,
 *   isAlive?: (pid: number) => boolean,
 *   sleep?: (ms: number) => Promise<void>,
 *   softWaitMs?: number,
 *   pollMs?: number,
 * }} input
 * @returns {Promise<'soft' | 'hard' | 'gone'>}
 */
export async function stopProcessTreeGracefully(input) {
  const pid = Number(input.pid);
  if (!Number.isFinite(pid) || pid <= 0) return 'gone';

  const softKill = input.softKill ?? ((id) => softKillTree(id));
  const hardKill = input.hardKill ?? ((id) => hardKillTree(id));
  const isAlive =
    input.isAlive ??
    ((id) => {
      try {
        process.kill(id, 0);
        return true;
      } catch {
        return false;
      }
    });
  const sleep =
    input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const softWaitMs = input.softWaitMs ?? 3000;
  const pollMs = input.pollMs ?? 250;

  if (!isAlive(pid)) return 'gone';

  softKill(pid);
  const deadline = Date.now() + softWaitMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return 'soft';
    await sleep(pollMs);
  }

  if (!isAlive(pid)) return 'soft';
  hardKill(pid);
  // 'hard' reports that a force-kill was issued. Whether the process actually
  // exited afterwards is left to the caller (e.g. via isAlive), because the
  // kill is asynchronous and a quick re-check here is not authoritative.
  return 'hard';
}

/**
 * After OpenCode crashes or is force-killed, kill leftover children that may
 * still hold an inherited listen handle (netstat often still shows the dead parent PID).
 * @param {{
 *   exitedPid?: number | null,
 *   listeningPids?: number[],
 *   listChildren?: (pid: number) => number[],
 *   isAlive?: (pid: number) => boolean,
 *   hardKill?: (pid: number) => void,
 * }} input
 * @returns {number[]} killed PIDs
 */
export function reapInheritedHolders(input) {
  const isAlive =
    input.isAlive ??
    ((id) => {
      try {
        process.kill(id, 0);
        return true;
      } catch {
        return false;
      }
    });
  const listChildren = input.listChildren ?? (() => []);
  const hardKill = input.hardKill ?? (() => {});
  const killed = new Set();

  const exited = Number(input.exitedPid);
  if (Number.isFinite(exited) && exited > 0) {
    for (const child of listChildren(exited)) {
      if (!isAlive(child)) continue;
      hardKill(child);
      killed.add(child);
    }
  }

  for (const pid of input.listeningPids ?? []) {
    const n = Number(pid);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (!isAlive(n)) continue;
    hardKill(n);
    killed.add(n);
  }

  return [...killed];
}

/**
 * Synchronously stop the WebUI process tree this host spawned. Designed for an
 * 'exit' handler where async work is impossible, so every dependency is a
 * synchronous callback. Targets the owned child PID (unambiguously ours) plus
 * any port listeners identified as our own `next start` via `isOwnedListener`
 * — so a reparented listener that survived a crash is stopped too, while an
 * unrelated app on the port is never touched (see resolveWebKillPids).
 * @param {{
 *   ownedPid?: number | null,
 *   listeningPids?: number[],
 *   isOwnedListener?: (pid: number) => boolean,
 *   hardKill?: (pid: number) => void,
 * }} input
 * @returns {number[]} killed PIDs
 */
export function stopWebTreeSync(input) {
  const hardKill = input.hardKill ?? (() => {});
  const targets = resolveWebKillPids({
    ownedPid: input.ownedPid,
    listeningPids: input.listeningPids,
    isOwnedListener: input.isOwnedListener,
  });
  const killed = [];
  for (const pid of targets) {
    hardKill(pid);
    killed.push(pid);
  }
  return killed;
}

/**
 * @param {number} pid
 * @param {{ execSync?: typeof import('child_process').execSync }} [deps]
 */
export function isProcessAlive(pid, deps = {}) {
  const id = Number(pid);
  if (!Number.isInteger(id) || id <= 0) return false;
  const run = deps.execSync ?? defaultExecSync;
  try {
    const output = run(`tasklist /FI "PID eq ${id}" /NH`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.includes(String(id));
  } catch {
    return false;
  }
}

/**
 * Prefer dispose + soft kill so Windows does not orphan the listen socket.
 * Falls back to taskkill /F only if the process is still alive.
 * @param {number[]} pids
 * @param {{
 *   opencodeUrl?: string,
 *   log?: (message: string) => void,
 *   sleep?: (ms: number) => Promise<void>,
 *   isAlive?: (pid: number) => boolean,
 *   hardKill?: (pid: number) => void,
 * }} [deps]
 */
export async function stopOpencodeProcessTree(pids, deps = {}) {
  const opencodeUrl = deps.opencodeUrl ?? '';
  const log = deps.log ?? (() => {});
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const isAlive = deps.isAlive ?? isProcessAlive;
  const hardKill = deps.hardKill ?? ((id) => hardKillTree(id));
  const unique = [...new Set(pids.filter(Boolean))];
  if (unique.length === 0) return;

  const disposed = await disposeOpencodeServer(opencodeUrl);
  if (disposed) {
    log('OpenCode /global/dispose acknowledged — waiting for children to release handles');
    await sleep(750);
  }

  for (const pid of unique) {
    if (!isAlive(pid)) continue;
    const how = await stopProcessTreeGracefully({
      pid,
      softKill: softKillTree,
      hardKill,
      isAlive,
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

/**
 * After crash/force-kill, reap children that may still hold an inherited listen handle.
 * @param {number | null} exitedPid
 * @param {{
 *   port?: number,
 *   log?: (message: string) => void,
 *   isAlive?: (pid: number) => boolean,
 *   hardKill?: (pid: number) => void,
 *   getListeningPids?: (port: number) => number[],
 *   listChildren?: (pid: number) => number[],
 * }} [deps]
 */
export function reapOpencodePortHolders(exitedPid, deps = {}) {
  const port = deps.port ?? 0;
  const log = deps.log ?? (() => {});
  const isAlive = deps.isAlive ?? isProcessAlive;
  const hardKill = deps.hardKill ?? ((id) => hardKillTree(id));
  const getListeningPids = deps.getListeningPids ?? (() => []);
  const listChildren = deps.listChildren ?? listChildPids;
  const listeningPids = getListeningPids(port);
  const killed = reapInheritedHolders({
    exitedPid,
    listeningPids,
    listChildren,
    isAlive,
    hardKill,
  });
  if (killed.length > 0) {
    log(
      `Reaped ${killed.length} leftover process(es) that may hold :${port} (${killed.join(', ')})`,
    );
  }
}

