/**
 * Windows Job Object supervisor for the tray host.
 *
 * Ghost LISTENING sockets appear when a process is TerminateProcess'd
 * (`taskkill /F`, console X after the 5s CTRL_CLOSE timeout, Task Manager)
 * while a child still holds an inherited copy of the listen handle. netstat
 * then reports the dead parent PID as LISTENING.
 *
 * JS cannot hold a Win32 job HANDLE, so a tiny C# helper (`job-holder.cs`)
 * owns the jobs. The helper's stdin is a pipe from this process:
 *  - ASSIGN puts OpenCode / WebUI / Caddy into a kill-on-close job
 *  - host crash / TerminateProcess closes the pipe → helper EOF → CloseHandle
 *    → JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE kills leftover members
 *  - an unexpected OpenCode exit sends TERMINATE so reparented grandchildren
 *    (ParentProcessId already 4/services) still die
 */

import { createHash } from 'crypto';
import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readSync, writeSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { listChildPids } from './process-stop.js';

export const JOB_HOLDER_SOURCE = join(
  dirname(fileURLToPath(import.meta.url)),
  'job-holder.cs',
);
const MAX_TREE = 32;
const LINE_MAX = 2048;

const CSC_CANDIDATES = [
  join(
    process.env.WINDIR || 'C:\\Windows',
    'Microsoft.NET',
    'Framework64',
    'v4.0.30319',
    'csc.exe',
  ),
  join(
    process.env.WINDIR || 'C:\\Windows',
    'Microsoft.NET',
    'Framework',
    'v4.0.30319',
    'csc.exe',
  ),
];

export function findCsc(deps = {}) {
  const exists = deps.existsSync ?? existsSync;
  const extra = deps.cscPath;
  const candidates = extra ? [extra, ...CSC_CANDIDATES] : CSC_CANDIDATES;
  return candidates.find((p) => exists(p)) || null;
}

export function jobHolderCachePath(dataDir, sourceText, deps = {}) {
  const hash = createHash('sha256').update(sourceText).digest('hex').slice(0, 16);
  const dir = deps.cacheDir ?? dataDir;
  return join(dir, `job-holder-${hash}.exe`);
}

export function compileJobHolder(sourcePath, outExe, deps = {}) {
  const csc = deps.cscPath ?? findCsc(deps);
  if (!csc) return { ok: false, error: 'csc.exe not found' };
  const run = deps.spawnSync ?? spawnSync;
  const result = run(csc, ['/nologo', '/target:exe', `/out:${outExe}`, sourcePath], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    return { ok: false, error: detail || `csc exited ${result.status}` };
  }
  return { ok: true, exe: outExe };
}

export function ensureJobHolderExe(dataDir, deps = {}) {
  const exists = deps.existsSync ?? existsSync;
  const mkdir = deps.mkdirSync ?? mkdirSync;
  const read = deps.readFileSync ?? readFileSync;
  const sourcePath = deps.sourcePath ?? JOB_HOLDER_SOURCE;
  let sourceText;
  try {
    sourceText = read(sourcePath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      error: `job-holder source missing: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const outExe = jobHolderCachePath(dataDir, sourceText, deps);
  if (exists(outExe)) return { ok: true, exe: outExe };
  mkdir(dirname(outExe), { recursive: true });
  return compileJobHolder(sourcePath, outExe, deps);
}

/**
 * Walk `rootPid` plus descendants (BFS). Used so a `.cmd` shim's grandchild
 * OpenCode process is assigned even if it spawned before the first ASSIGN.
 * @param {number} rootPid
 * @param {{ listChildren?: (pid: number) => number[] }} [deps]
 * @returns {number[]}
 */
export function collectDescendantPids(rootPid, deps = {}) {
  const id = Number(rootPid);
  if (!Number.isInteger(id) || id <= 0) return [];
  const listChildren = deps.listChildren ?? listChildPids;
  const seen = new Set();
  const queue = [id];
  while (queue.length > 0 && seen.size < MAX_TREE) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    let children = [];
    try {
      children = listChildren(pid) ?? [];
    } catch {
      children = [];
    }
    for (const child of children) {
      const n = Number(child);
      if (Number.isInteger(n) && n > 0 && !seen.has(n)) queue.push(n);
    }
  }
  return [...seen];
}

export function parseJobHolderReply(line) {
  const text = String(line ?? '').replace(/\r$/, '').trim();
  if (text === 'OK' || text === 'READY') return { ok: true, text };
  if (text.startsWith('ERR ')) return { ok: false, error: text.slice(4) };
  return { ok: false, error: `unexpected reply: ${text || '<empty>'}` };
}

function sleepSync(ms) {
  try {
    const ia = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(ia, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // fallback spin
    }
  }
}

/** Blocking one-byte reads so ASSIGN cannot race a subsequent force-kill. */
export function readLineSync(fd, deps = {}) {
  const read = deps.readSync ?? readSync;
  const timeoutMs = deps.readTimeoutMs ?? 8000;
  const deadline = Date.now() + timeoutMs;
  let line = '';
  const buf = Buffer.alloc(1);
  for (let i = 0; i < LINE_MAX; ) {
    let n;
    try {
      n = read(fd, buf, 0, 1, null);
    } catch (err) {
      const retry =
        err && (err.code === 'EAGAIN' || err.code === 'EWOULDBLOCK' || err.code === 'EINTR');
      if (retry && Date.now() < deadline) {
        sleepSync(15);
        continue;
      }
      throw err;
    }
    if (n === 0) {
      if (line.length > 0 || Date.now() >= deadline) break;
      sleepSync(15);
      continue;
    }
    i += 1;
    if (buf[0] === 10) break;
    if (buf[0] !== 13) line += String.fromCharCode(buf[0]);
  }
  return line;
}

export function writeLineSync(fd, line, deps = {}) {
  const write = deps.writeSync ?? writeSync;
  write(fd, `${line}\n`);
}

function startJobHolderProcess(exe, deps = {}) {
  const spawnImpl = deps.spawn ?? spawn;
  const error = deps.error ?? (() => {});
  const proc = spawnImpl(exe, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (!proc?.stdin) {
    try {
      proc?.kill?.();
    } catch {
      // ignore
    }
    return { ok: false, error: 'job-holder spawn lost stdin' };
  }
  proc.stdin.setDefaultEncoding('utf8');
  proc.stdout?.setEncoding?.('utf8');
  proc.stderr?.setEncoding?.('utf8');
  // stdin.write() only flushes after the socket is open (the 'spawn' event).
  // A fully sync caller that never returns to the event loop queues bytes in
  // JS and never delivers CREATE/ASSIGN — that is why node --test used to
  // see a live sleeper despite adopt() returning true. After spawn, write()
  // uses uv_try_write and reaches the helper even during a later sync stretch.
  // Do not writeSync(proc.stdin.fd): mixing that with the Socket handle drops
  // bytes on Windows anonymous pipes.
  const queued = [];
  let stdinReady = false;
  let readySettled = false;
  let resolveReady = () => {};
  const ready = new Promise((resolve) => {
    resolveReady = () => {
      if (readySettled) return;
      readySettled = true;
      resolve(true);
    };
  });

  function sendNow(line) {
    if (!stdinReady) {
      queued.push(line);
      return { ok: true, text: 'queued' };
    }
    proc.stdin.write(`${line}\n`);
    return { ok: true, text: 'OK' };
  }

  function armStdin() {
    if (stdinReady) return;
    stdinReady = true;
    const pending = queued.splice(0);
    for (const line of pending) {
      proc.stdin.write(`${line}\n`);
    }
  }

  proc.once('spawn', armStdin);
  proc.stdin.on('error', (err) => {
    if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') return;
    error(`job-holder stdin: ${err instanceof Error ? err.message : String(err)}`);
  });
  proc.stdout?.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      const text = line.replace(/\r$/, '').trim();
      if (text === 'READY') resolveReady();
      const parsed = parseJobHolderReply(line);
      if (!parsed.ok && text) error(`job-holder: ${parsed.error}`);
    }
  });
  proc.stderr?.on('data', (chunk) => {
    const text = String(chunk).trim();
    if (text) error(`job-holder stderr: ${text}`);
  });
  proc.on('exit', (code, signal) => {
    if (code && code !== 0) {
      error(`job-holder exited (code=${code}, signal=${signal ?? 'none'})`);
    } else if (!readySettled) {
      resolveReady();
    }
  });
  return {
    ok: true,
    proc,
    ready,
    send: sendNow,
  };
}

/**
 * @param {{
 *   log?: (msg: string) => void,
 *   error?: (msg: string) => void,
 *   dataDir: string,
 *   send?: (line: string) => { ok: boolean, error?: string },
 *   startHolder?: () => { pid?: number, kill?: () => void } | null,
 * }} [opts]
 */
export function createJobSupervisor(opts = {}) {
  const log = opts.log ?? (() => {});
  const error = opts.error ?? (() => {});
  const created = new Set();
  let holder = null;
  let enabled = false;
  let sendImpl = opts.send ?? null;
  let readyPromise = Promise.resolve(false);

  function send(line) {
    if (!enabled || typeof sendImpl !== 'function') {
      return { ok: false, error: 'job supervisor is disabled' };
    }
    try {
      return sendImpl(line);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  function ensureCreated(id) {
    if (created.has(id)) return true;
    const result = send(`CREATE ${id}`);
    if (!result.ok) {
      error(`Job ${id} create failed: ${result.error}`);
      return false;
    }
    created.add(id);
    return true;
  }

  return {
    get enabled() {
      return enabled;
    },
    get holderPid() {
      return holder?.pid ?? null;
    },
    get ready() {
      return readyPromise;
    },
    start() {
      if (enabled) return true;
      if (typeof opts.send === 'function') {
        holder = typeof opts.startHolder === 'function' ? opts.startHolder() : { pid: 0 };
        sendImpl = opts.send;
        enabled = true;
        readyPromise = Promise.resolve(true);
        log('Windows job supervisor ready (injected)');
        return true;
      }
      if (process.platform !== 'win32') return false;
      const built = ensureJobHolderExe(opts.dataDir, opts);
      if (!built.ok) {
        error(`Windows job supervisor disabled: ${built.error}`);
        return false;
      }
      const spawned = startJobHolderProcess(built.exe, opts);
      if (!spawned.ok) {
        error(`Windows job supervisor disabled: ${spawned.error}`);
        return false;
      }
      holder = spawned.proc;
      sendImpl = spawned.send;
      readyPromise = spawned.ready ?? Promise.resolve(true);
      enabled = true;
      log('Windows job supervisor ready (kill-on-close jobs)');
      return true;
    },
    adopt(id, pid) {
      if (!enabled) return false;
      const root = Number(pid);
      if (!Number.isInteger(root) || root <= 0) return false;
      if (!ensureCreated(id)) return false;
      const tree = collectDescendantPids(root, opts);
      let any = false;
      for (const member of tree) {
        const result = send(`ASSIGN ${id} ${member}`);
        if (result.ok) any = true;
        else error(`Job ${id} assign PID ${member} failed: ${result.error}`);
      }
      return any;
    },
    drop(id) {
      if (!enabled || !created.has(id)) return;
      send(`TERMINATE ${id}`);
      send(`CLOSE ${id}`);
      created.delete(id);
    },
    /**
     * Close the helper stdin pipe without TerminateProcess. This is what
     * happens when the host is force-killed: the helper sees EOF, DropAll
     * runs TerminateJobObject, then job handles close. Killing the helper
     * itself skips DropAll and nested-job KILL_ON_JOB_CLOSE often leaves
     * members alive (node --test workers and LeafCode.exe both wrap the
     * tree in a parent job).
     */
    closeStdin() {
      try {
        holder?.stdin?.end?.();
      } catch {
        // best effort
      }
    },
    disposeSync() {
      if (!enabled) return;
      for (const id of [...created]) {
        send(`TERMINATE ${id}`);
        send(`CLOSE ${id}`);
      }
      created.clear();
      enabled = false;
      sendImpl = null;
      try {
        holder?.stdin?.end?.();
      } catch {
        // best effort
      }
      holder = null;
    },
  };
}
