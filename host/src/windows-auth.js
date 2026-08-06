import { spawn as nodeSpawn } from 'child_process';
import {
  existsSync as nodeExistsSync,
  mkdirSync as nodeMkdirSync,
  readFileSync as nodeReadFileSync,
  writeFileSync as nodeWriteFileSync,
} from 'fs';
import { dirname, dirname as nodeDirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Authenticate against real Windows accounts.
 *
 * Validation runs in Windows PowerShell via
 * System.DirectoryServices.AccountManagement.PrincipalContext.ValidateCredentials,
 * which needs no native module. `powershell.exe` (5.1) is used deliberately
 * rather than `pwsh`, because the AccountManagement assembly is not loadable by
 * default on PowerShell 7.
 *
 * The password is written to the child's stdin, never passed as an argument:
 * command lines are world-readable on Windows.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPT = join(__dirname, '..', '..', 'scripts', 'validate-windows-credentials.ps1');
const DEFAULT_TIMEOUT_MS = 15_000;

export function windowsCredentialScriptPath() {
  return DEFAULT_SCRIPT;
}

/**
 * Split a Windows logon name into its domain and account parts.
 *
 * Accepts `user`, `DOMAIN\user` and `user@domain`. `kind` is `machine` when the
 * name resolves to a local account, `domain` otherwise.
 *
 * @param {string} raw
 * @param {string} [computerName]
 * @returns {{ ok: false } | { ok: true, raw: string, name: string, domain: string | null, kind: 'machine' | 'domain' }}
 */
export function parseWindowsUsername(raw, computerName = process.env.COMPUTERNAME ?? '') {
  if (typeof raw !== 'string') return { ok: false };
  const value = raw.trim();
  if (!value) return { ok: false };
  // Reject control characters and newlines: credentials are framed line-by-line
  // over stdin, so an embedded newline would let a caller inject the password
  // field (or a third line) and desynchronise the protocol.
  if (/[\r\n\u0000-\u001f]/.test(value)) return { ok: false };

  let domain = null;
  let name = value;

  const backslash = value.indexOf('\\');
  if (backslash !== -1) {
    domain = value.slice(0, backslash);
    name = value.slice(backslash + 1);
  } else {
    const at = value.indexOf('@');
    if (at !== -1) {
      name = value.slice(0, at);
      domain = value.slice(at + 1);
    }
  }

  if (!name || name.includes('\\')) return { ok: false };
  if (domain !== null && !domain) return { ok: false };

  const local = computerName.trim().toLowerCase();
  const d = domain?.toLowerCase() ?? null;
  const kind =
    d === null || d === '.' || d === 'localhost' || (local !== '' && d === local)
      ? 'machine'
      : 'domain';

  return { ok: true, raw: value, name, domain, kind };
}

/**
 * Verify a Windows username/password pair.
 *
 * Resolves false (never throws) for bad credentials, a non-Windows host, a
 * missing script, a timeout, or any PowerShell failure — a validator that
 * cannot run must not be mistaken for a successful logon.
 *
 * @param {string} username
 * @param {string} password
 * @param {{
 *   spawn?: typeof nodeSpawn,
 *   scriptPath?: string,
 *   timeoutMs?: number,
 *   platform?: string,
 *   onError?: (message: string) => void,
 * }} [deps]
 * @returns {Promise<boolean>}
 */
export function verifyWindowsCredentials(username, password, deps = {}) {
  const {
    spawn = nodeSpawn,
    scriptPath = DEFAULT_SCRIPT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    platform = process.platform,
    onError,
  } = deps;

  if (platform !== 'win32') return Promise.resolve(false);
  if (typeof password !== 'string' || password === '') return Promise.resolve(false);
  const parsed = parseWindowsUsername(username);
  if (!parsed.ok) return Promise.resolve(false);
  // The password is framed as a single stdin line.
  if (/[\r\n]/.test(password)) return Promise.resolve(false);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
    } catch (err) {
      onError?.(`powershell の起動に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      resolve(false);
      return;
    }

    let settled = false;
    let stdout = '';
    let stderr = '';

    const finish = (value, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (message) onError?.(message);
      try {
        child.kill();
      } catch {
        // already gone
      }
      resolve(value);
    };

    const timer = setTimeout(() => {
      finish(false, 'Windows 認証がタイムアウトしました');
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      finish(false, `Windows 認証を実行できません: ${err instanceof Error ? err.message : String(err)}`);
    });

    child.on('close', () => {
      const verdict = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
      if (verdict === 'VALID') {
        finish(true);
        return;
      }
      if (verdict === 'INVALID') {
        finish(false);
        return;
      }
      const detail = verdict.startsWith('ERROR:')
        ? verdict.slice('ERROR:'.length)
        : verdict || stderr.trim() || 'unknown failure';
      finish(false, `Windows 認証に失敗しました: ${detail}`);
    });

    try {
      // Send the trimmed logon name and let the script do its own domain split,
      // so both sides agree on what was validated. UTF-8 so non-ASCII
      // credentials match what the script decodes.
      child.stdin?.end(`${parsed.raw}\n${password}\n`, 'utf8');
    } catch (err) {
      finish(false, `Windows 認証へ資格情報を渡せません: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

/**
 * Attempt limiter keyed by an arbitrary string (a username, or a source IP).
 *
 * Windows counts every ValidateCredentials failure toward its account lockout
 * policy, so an unthrottled login endpoint would let anyone on the LAN lock the
 * operator out of their own PC. Throttling here keeps a brute-force attempt from
 * reaching Windows in the first place.
 *
 * `store` optionally persists the counters. Without it the limiter resets on
 * every host restart, so an attacker who can trigger (or simply wait for) a
 * restart gets a fresh budget.
 *
 * @param {{
 *   maxAttempts?: number,
 *   windowMs?: number,
 *   now?: () => number,
 *   store?: { load: () => [string, { count: number, first: number }][], save: (entries: [string, { count: number, first: number }][]) => void },
 * }} [options]
 */
export function createLoginThrottle(options = {}) {
  const {
    maxAttempts = 5,
    windowMs = 5 * 60_000,
    now = () => Date.now(),
    store = null,
  } = options;
  /** @type {Map<string, { count: number, first: number }>} */
  const attempts = new Map(store ? store.load() : []);

  function persist() {
    if (!store) return;
    try {
      store.save([...attempts]);
    } catch {
      // A failed write must never block a login response.
    }
  }

  function key(username) {
    return String(username ?? '').trim().toLowerCase();
  }

  function prune(k) {
    const entry = attempts.get(k);
    if (!entry) return null;
    if (now() - entry.first >= windowMs) {
      attempts.delete(k);
      return null;
    }
    return entry;
  }

  return {
    /** Milliseconds until the next attempt is allowed, or 0 when allowed now. */
    retryAfterMs(username) {
      const entry = prune(key(username));
      if (!entry || entry.count < maxAttempts) return 0;
      return Math.max(0, entry.first + windowMs - now());
    },
    isBlocked(username) {
      const entry = prune(key(username));
      return Boolean(entry && entry.count >= maxAttempts);
    },
    recordFailure(username) {
      const k = key(username);
      const entry = prune(k);
      if (!entry) {
        attempts.set(k, { count: 1, first: now() });
      } else {
        entry.count += 1;
      }
      persist();
    },
    reset(username) {
      if (attempts.delete(key(username))) persist();
    },
    clear() {
      attempts.clear();
      persist();
    },
  };
}

/**
 * Disk backing for {@link createLoginThrottle}.
 *
 * Entries older than `windowMs` are dropped on load, so the file cannot grow
 * without bound and a stale counter never blocks a legitimate login.
 *
 * @param {{ file: string, windowMs?: number, now?: () => number, fs?: object }} options
 */
export function createThrottleStore({
  file,
  windowMs = 5 * 60_000,
  now = () => Date.now(),
  fs: fsApi = {},
}) {
  const read = fsApi.readFileSync ?? nodeReadFileSync;
  const write = fsApi.writeFileSync ?? nodeWriteFileSync;
  const exists = fsApi.existsSync ?? nodeExistsSync;
  const mkdir = fsApi.mkdirSync ?? nodeMkdirSync;

  return {
    load() {
      try {
        if (!exists(file)) return [];
        const parsed = JSON.parse(read(file, 'utf8'));
        if (!Array.isArray(parsed)) return [];
        const cutoff = now() - windowMs;
        return parsed
          .filter(
            (e) =>
              e &&
              typeof e.key === 'string' &&
              typeof e.count === 'number' &&
              typeof e.first === 'number' &&
              e.first > cutoff,
          )
          .map((e) => [e.key, { count: e.count, first: e.first }]);
      } catch {
        return [];
      }
    },
    save(entries) {
      try {
        mkdir(nodeDirname(file), { recursive: true });
        const cutoff = now() - windowMs;
        const live = entries
          .filter(([, v]) => v.first > cutoff)
          .map(([key, v]) => ({ key, count: v.count, first: v.first }));
        write(file, JSON.stringify(live), 'utf8');
      } catch {
        // Best effort — losing persistence only costs restart resistance.
      }
    },
  };
}
