import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import http from 'http';
import { createAuditLog } from './audit-log.js';
import { writeSecretFile } from './secure-file.js';
import { createLoginThrottle } from './windows-auth.js';

/**
 * Address of the original caller, forwarded by the BFF.
 *
 * The control plane only ever sees a loopback connection, so it cannot derive
 * this itself. Used for the audit log and the per-IP login limit only — never
 * for an authorization decision, since any local process could forge it.
 */
const CLIENT_IP_HEADER = 'x-ocw-client-ip';

/** @param {import('http').IncomingMessage} req */
function clientIpOf(req) {
  const raw = req.headers?.[CLIENT_IP_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

/**
 * Match a host-control HTTP route.
 * @param {string} method
 * @param {string} pathname
 * @returns {'webui' | 'opencode' | 'all' | 'health' | 'stop-webui' | 'voice-input' | 'logs' | 'allow-firewall' | 'users' | 'auth' | 'auth-config' | 'browser-config' | null}
 */
export function matchControlRoute(method, pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  const m = method.toUpperCase();
  if (m === 'GET' && path === '/health') return 'health';
  if (m === 'GET' && path === '/logs') return 'logs';
  if (m === 'GET' && path === '/users') return 'users';
  if (m === 'POST' && path === '/users') return 'users';
  if (m === 'DELETE' && path === '/users') return 'users';
  if (m === 'GET' && path === '/auth/config') return 'auth-config';
  if (m === 'POST' && path === '/auth/config') return 'auth-config';
  if (m === 'GET' && path === '/browser/config') return 'browser-config';
  if (m === 'POST' && path === '/browser/config') return 'browser-config';
  if (m === 'POST' && path === '/auth/login') return 'auth';
  if (m === 'POST' && path === '/auth/logout') return 'auth';
  if (m === 'POST' && path === '/auth/verify') return 'auth';
  if (m !== 'POST') return null;
  if (path === '/restart/webui') return 'webui';
  if (path === '/restart/opencode') return 'opencode';
  if (path === '/restart/all') return 'all';
  if (path === '/stop/webui') return 'stop-webui';
  if (path === '/voice-input') return 'voice-input';
  if (path === '/allow-firewall') return 'allow-firewall';
  return null;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1']);

/**
 * Reject a Host header that does not name the loopback interface this server
 * listens on.
 *
 * The control plane only binds `127.0.0.1`, but that does not stop a browser
 * from reaching it: an attacker can register a domain that resolves to
 * `127.0.0.1` (DNS rebinding), at which point the browser treats the request as
 * same-origin and CORS cannot help. Only accepting the loopback hostnames the
 * server itself uses closes the hole. The caller may pass the port it listens
 * on so a host without a port still matches, and vice versa.
 *
 * @param {string | string[] | undefined} hostHeader
 * @param {number} [expectedPort]
 * @returns {boolean}
 */
export function isLoopbackHostHeader(hostHeader, expectedPort) {
  const raw = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (!raw) return false;
  const value = raw.trim().toLowerCase();
  if (!value) return false;

  // Strip an IPv6 bracket: `[::1]:18765` -> `::1`.
  let host = value;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end === -1) return false;
    host = host.slice(1, end);
  } else {
    // IPv4 or hostname — drop a trailing :port (only when not an IPv6 address).
    const colon = host.lastIndexOf(':');
    if (colon !== -1 && !host.includes(':', colon + 1)) {
      host = host.slice(0, colon);
    }
  }

  if (!LOOPBACK_HOSTS.has(host)) return false;
  if (expectedPort === undefined) return true;

  // Verify the port too, when one was supplied.
  const portMatch = /:(\d+)$/.exec(value.endsWith(']') ? value : value.replace(/^\[.*?\]/, ''));
  if (!portMatch) return true; // no port given — trust the hostname match
  return Number(portMatch[1]) === expectedPort;
}

/**
 * Parse a JSON body up to a safe size.
 * @param {import('http').IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<unknown | null>}
 */
function readJsonBody(req, maxBytes = 65_536) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Sign a simple session token with HMAC.
 *
 * The payload is `username:jti:ts`, so the timestamp split (lastIndexOf) is
 * unaffected by a username or jti that happens to contain a colon. The jti
 * lets us revoke a specific session without invalidating every other one.
 * @param {string} secret
 * @param {string} username
 * @returns {string}
 */
function signSessionToken(secret, username) {
  const jti = randomBytes(8).toString('base64url');
  const payload = `${username}:${jti}:${Date.now()}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

/**
 * Verify a session token and return the username and jti if valid.
 * @param {string} secret
 * @param {string} token
 * @returns {{ username: string, jti: string } | null}
 */
function verifySessionToken(secret, token) {
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(Buffer.from(payloadB64, 'base64url').toString('utf8')).digest('base64url');
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  const payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  // The timestamp is appended last, so split on the LAST colon: indexOf would
  // truncate any username or jti that itself contains one.
  const tsColon = payload.lastIndexOf(':');
  if (tsColon === -1) return null;
  const ts = Number(payload.slice(tsColon + 1));
  if (!Number.isFinite(ts)) return null;
  // Reject tokens dated in the future beyond a little clock skew, so a forged
  // timestamp cannot extend a session indefinitely.
  if (ts - Date.now() > 60_000) return null;
  // 7-day session
  if (Date.now() - ts > 7 * 24 * 60 * 60 * 1000) return null;
  const rest = payload.slice(0, tsColon);
  // The jti is the segment between the last two colons.
  const jtiColon = rest.lastIndexOf(':');
  if (jtiColon === -1) return null;
  const username = rest.slice(0, jtiColon);
  const jti = rest.slice(jtiColon + 1);
  if (!username || !jti) return null;
  return { username, jti };
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REVOKE_FILE = 'revoked-sessions.json';

function revokeFilePath() {
  const base = process.env.APPDATA || join(process.env.USERPROFILE || process.env.HOME || '.', 'AppData', 'Roaming');
  return join(base, 'opencode-webui', REVOKE_FILE);
}

/**
 * @returns {Map<string, number>} jti -> the time it was revoked, epoch ms
 */
function readRevokedJtis() {
  try {
    const file = revokeFilePath();
    if (!existsSync(file)) return new Map();
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return new Map();
    const now = Date.now();
    const entries = parsed
      .filter((e) => e && typeof e.jti === 'string' && typeof e.ts === 'number' && now - e.ts < SESSION_TTL_MS)
      .map((e) => [e.jti, e.ts]);
    return new Map(entries);
  } catch {
    return new Map();
  }
}

/** @param {Map<string, number>} map */
function writeRevokedJtis(map) {
  try {
    const arr = [...map].map(([jti, ts]) => ({ jti, ts }));
    writeSecretFile(revokeFilePath(), JSON.stringify(arr, null, 2));
  } catch {
    // best effort — an unwritable file just means revocation is per-process only
  }
}

/**
 * Track revoked session jtis for the lifetime of this process + on disk so a
 * restart does not silently revalidate a logged-out token.
 *
 * Each jti keeps its own revocation timestamp (a Map, not a Set) so that
 * revoking a new session never resets an older entry's age — otherwise every
 * write would refresh every existing entry's timestamp to "now" and the file
 * would grow without bound, never pruning old entries.
 *
 * `persist: false` keeps everything in memory only — used by tests so they do
 * not read or write the real %APPDATA%\opencode-webui\revoked-sessions.json.
 * @param {{ persist?: boolean }} [options]
 */
export function createRevocationStore({ persist = true } = {}) {
  let revoked = persist ? readRevokedJtis() : new Map();
  return {
    isRevoked(jti) {
      return revoked.has(jti);
    },
    revoke(jti) {
      if (!jti || revoked.has(jti)) return;
      revoked.set(jti, Date.now());
      if (persist) writeRevokedJtis(revoked);
    },
    clear() {
      revoked = persist ? readRevokedJtis() : new Map();
    },
  };
}

/** Single source of truth for the session cookie the BFF forwards to the browser. */
function authCookieHeader(token) {
  return `webui_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`;
}

function trustedDeviceCookieHeader(token) {
  return `webui_trusted_device=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7776000`;
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', [
    'webui_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    'webui_trusted_device=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
  ]);
}

/**
 * Extract the webui_session cookie value from a request header string.
 * @param {string | string[] | undefined} header
 * @returns {string | null}
 */
function getSessionCookie(header) {
  const raw = Array.isArray(header) ? header.join('; ') : header;
  if (!raw) return null;
  const match = raw.match(/(?:^|;\s*)webui_session=([^;]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function getTrustedDeviceCookie(header) {
  const raw = Array.isArray(header) ? header.join('; ') : header;
  const match = raw?.match(/(?:^|;\s*)webui_trusted_device=([^;]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * @typedef {object} AuthUserRecord
 * @property {string} username
 * @property {string} updatedAt
 */

/**
 * @typedef {object} AuthStore
 * @property {() => AuthUserRecord[]} listUsers
 * @property {(username: string, password: string) => boolean} verifyUser
 * @property {(username: string, password: string) => { ok: boolean, error?: string }} upsertUser
 * @property {(username: string) => { ok: boolean, error?: string }} deleteUser
 * @property {() => boolean} hasUsers
 * @property {((username: string, password: string) => Promise<boolean>)} [verifyWindowsUser]
 * @property {(() => { windowsAuth: boolean })} [readConfig]
 * @property {((patch: { windowsAuth?: boolean }) => { windowsAuth: boolean })} [writeConfig]
 * @property {boolean} [windowsAuthSupported]
 * @property {((username: string) => boolean)} [isAdmin]
 */

/**
 * Request handler for the localhost control plane. Exported so it can be
 * exercised without binding a TCP port.
 * @param {{
 *   onRestartWebui: () => Promise<void> | void,
 *   onRestartOpencode: () => Promise<void> | void,
 *   onRestartAll: () => Promise<void> | void,
 *   onStopWebui?: () => Promise<void> | void,
 *   onVoiceInput?: () => Promise<void> | void,
 *   onGetLogs?: (since: number | null) => { entries: unknown[], nextSeq: number },
 *   onAllowFirewall?: () => Promise<Record<string, unknown> | void> | Record<string, unknown> | void,
 *   authStore?: AuthStore,
 *   sessionSecret?: string,
 *   loginThrottle?: ReturnType<typeof createLoginThrottle>,
 *   ipThrottle?: ReturnType<typeof createLoginThrottle>,
 *   controlPort?: number,
 *   revocationStore?: ReturnType<typeof createRevocationStore>,
 *   trustedDeviceStore?: { issue: (username: string) => string, verify: (token: string) => { username: string } | null, revoke: (token: string) => void },
 *   auditLog?: { record: (event: object) => void },
 * }} handlers
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => Promise<void>}
 */
export function createControlRequestHandler(handlers) {
  // Shared across requests so a brute-force attempt cannot reset its own count.
  const throttle = handlers.loginThrottle ?? createLoginThrottle();
  // Second limiter keyed by source address. Per-username alone lets an attacker
  // spend a full budget on every account in turn; per-IP caps the total spend
  // from one origin. Its budget is higher because one address can legitimately
  // host several users (a shared PC, or everyone behind one NAT).
  const ipThrottle = handlers.ipThrottle ?? createLoginThrottle({ maxAttempts: 20 });
  const controlPort = typeof handlers.controlPort === 'number' ? handlers.controlPort : undefined;
  const revocationStore = handlers.revocationStore ?? createRevocationStore();
  const auditLog = handlers.auditLog ?? createAuditLog();

  /**
   * Resolve the verified session from a request's cookie or a forwarded
   * token body. Returns null for any failure.
   * @returns {{ username: string, jti: string } | null}
   */
  async function resolveSession(req) {
    const secret = handlers.sessionSecret || 'open-code-webui-no-secret';
    const token = getSessionCookie(req.headers?.cookie);
    const session = token ? verifySessionToken(secret, token) : null;
    if (!session || revocationStore.isRevoked(session.jti)) return null;
    return session;
  }

  return async (req, res) => {
    // DNS rebinding guard: a browser can reach 127.0.0.1:18765 via an attacker
    // domain that resolves to 127.0.0.1, making the request same-origin and
    // bypassing CORS. Only accept a Host header that names the loopback interface
    // (and, when known, this server's port). This runs before route matching so
    // nothing else leaks through a typo in the allowlist.
    if (!isLoopbackHostHeader(req.headers?.host, controlPort)) {
      res.writeHead(403, JSON_HEADERS);
      res.end(JSON.stringify({ ok: false, error: 'host header is not loopback' }));
      return;
    }

    const method = req.method ?? 'GET';
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      pathname = '/';
    }

    const route = matchControlRoute(method, pathname);
    if (!route) {
      res.writeHead(404, JSON_HEADERS);
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }

    if (route === 'health') {
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ ok: true, service: 'opencode-webui-host' }));
      return;
    }

    if (route === 'stop-webui') {
      // Unlike restart, the caller (build.bat) must know the port is actually
      // free before it overwrites web/.next, so respond only after the stop
      // completes. A 501 tells the caller this host cannot stop the WebUI, so
      // it must not fall back to killing (the host would just restart it).
      if (typeof handlers.onStopWebui !== 'function') {
        res.writeHead(501, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'stop is not supported by this host' }));
        return;
      }
      try {
        await handlers.onStopWebui();
      } catch (err) {
        res.writeHead(500, JSON_HEADERS);
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        return;
      }
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ ok: true, target: 'webui', stopped: true }));
      return;
    }

    if (route === 'allow-firewall') {
      if (typeof handlers.onAllowFirewall !== 'function') {
        res.writeHead(501, JSON_HEADERS);
        res.end(
          JSON.stringify({ ok: false, error: 'firewall allow is not supported by this host' }),
        );
        return;
      }
      try {
        const result = await handlers.onAllowFirewall();
        res.writeHead(200, JSON_HEADERS);
        res.end(JSON.stringify({ ok: true, target: 'allow-firewall', ...(result ?? {}) }));
      } catch (err) {
        res.writeHead(500, JSON_HEADERS);
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
      return;
    }

    if (route === 'logs') {
      if (typeof handlers.onGetLogs !== 'function') {
        res.writeHead(501, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'logs are not supported by this host' }));
        return;
      }
      let since = null;
      const rawSince = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get(
        'since',
      );
      if (rawSince !== null) {
        const n = Number(rawSince);
        if (Number.isFinite(n)) since = n;
      }
      const { entries, nextSeq } = handlers.onGetLogs(since);
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ entries, nextSeq }));
      return;
    }

    if (route === 'voice-input') {
      if (typeof handlers.onVoiceInput !== 'function') {
        res.writeHead(501, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'voice input is not supported by this host' }));
        return;
      }
      try {
        await handlers.onVoiceInput();
      } catch (err) {
        res.writeHead(500, JSON_HEADERS);
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        return;
      }
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ ok: true, target: 'voice-input', launched: true }));
      return;
    }

    if (route === 'users') {
      const authStore = handlers.authStore;
      if (!authStore) {
        res.writeHead(501, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'user management is not supported by this host' }));
        return;
      }
      const method = req.method?.toUpperCase() ?? 'GET';
      if (method === 'GET') {
        res.writeHead(200, JSON_HEADERS);
        res.end(JSON.stringify({ users: authStore.listUsers() }));
        return;
      }

      // Mutating operations (POST/DELETE) require an admin session. The one
      // exception is the first POST on a fresh install: there cannot be an
      // admin session until that first admin user exists.
      const session = await resolveSession(req);
      const ip = clientIpOf(req) ?? undefined;
      const bootstrap = method === 'POST' && !authStore.hasUsers();
      if ((!session && !bootstrap) || (session && authStore.isAdmin?.(session.username) !== true)) {
        auditLog.record({
          action: 'authz.denied',
          actor: session?.username,
          target: '/users',
          ip,
          result: 'deny',
          reason: session ? 'not_admin' : 'no_session',
        });
        res.writeHead(403, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'admin session required' }));
        return;
      }

      if (method === 'DELETE') {
        const body = await readJsonBody(req);
        const username = isPlainObject(body) && typeof body.username === 'string' ? body.username : '';
        if (!username) {
          res.writeHead(400, JSON_HEADERS);
          res.end(JSON.stringify({ ok: false, error: 'username is required' }));
          return;
        }
        const result = authStore.deleteUser(username);
        auditLog.record({
          action: 'user.delete',
          actor: session.username,
          target: username,
          ip,
          result: result.ok ? 'allow' : 'deny',
          reason: result.ok ? undefined : result.error,
        });
        res.writeHead(result.ok ? 200 : 404, JSON_HEADERS);
        res.end(JSON.stringify(result));
        return;
      }
      // POST
      const body = await readJsonBody(req);
      const username = isPlainObject(body) && typeof body.username === 'string' ? body.username : '';
      const password = isPlainObject(body) && typeof body.password === 'string' ? body.password : '';
      if (!username || !password) {
        res.writeHead(400, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'username and password are required' }));
        return;
      }
      const existed = authStore.listUsers().some(
        (u) => u.username.trim().toLowerCase() === username.trim().toLowerCase(),
      );
      const result = authStore.upsertUser(username, password);
      auditLog.record({
        // The password itself is never recorded, only that it was set.
        action: existed ? 'user.update' : 'user.create',
        actor: session?.username ?? username,
        target: username,
        ip,
        result: result.ok ? 'allow' : 'deny',
        reason: result.ok ? undefined : result.error,
      });
      res.writeHead(result.ok ? 200 : 400, JSON_HEADERS);
      res.end(JSON.stringify(result));
      return;
    }

    if (route === 'auth-config') {
      const authStore = handlers.authStore;
      if (!authStore?.readConfig) {
        res.writeHead(501, JSON_HEADERS);
        res.end(
          JSON.stringify({ ok: false, error: 'auth config is not supported by this host' }),
        );
        return;
      }
      const supported = authStore.windowsAuthSupported === true;
      if ((req.method?.toUpperCase() ?? 'GET') === 'GET') {
        const config = authStore.readConfig();
        res.writeHead(200, JSON_HEADERS);
        res.end(
          JSON.stringify({
            windowsAuth: config.windowsAuth === true,
            windowsAuthSupported: supported,
            hasUsers: authStore.hasUsers(),
          }),
        );
        return;
      }
      // POST — admin only, like /users mutations.
      if (!authStore.writeConfig) {
        res.writeHead(501, JSON_HEADERS);
        res.end(
          JSON.stringify({ ok: false, error: 'auth config is read-only on this host' }),
        );
        return;
      }
      const session = await resolveSession(req);
      const configIp = clientIpOf(req) ?? undefined;
      if (!session || authStore.isAdmin?.(session.username) !== true) {
        auditLog.record({
          action: 'authz.denied',
          actor: session?.username,
          target: '/auth/config',
          ip: configIp,
          result: 'deny',
          reason: session ? 'not_admin' : 'no_session',
        });
        res.writeHead(403, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'admin session required' }));
        return;
      }
      const body = await readJsonBody(req);
      if (!isPlainObject(body) || typeof body.windowsAuth !== 'boolean') {
        res.writeHead(400, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'windowsAuth must be a boolean' }));
        return;
      }
      if (body.windowsAuth && !supported) {
        res.writeHead(400, JSON_HEADERS);
        res.end(
          JSON.stringify({
            ok: false,
            error: 'Windows 認証はこの OS では利用できません',
          }),
        );
        return;
      }
      const saved = authStore.writeConfig({ windowsAuth: body.windowsAuth });
      auditLog.record({
        action: 'authconfig.update',
        actor: session.username,
        target: 'windowsAuth',
        ip: configIp,
        result: 'allow',
        reason: saved.windowsAuth === true ? 'enabled' : 'disabled',
      });
      res.writeHead(200, JSON_HEADERS);
      res.end(
        JSON.stringify({
          ok: true,
          windowsAuth: saved.windowsAuth === true,
          windowsAuthSupported: supported,
          hasUsers: authStore.hasUsers(),
        }),
      );
      return;
    }

    if (route === 'browser-config') {
      const browserConfig = handlers.browserConfig;
      if (!browserConfig?.read) {
        res.writeHead(501, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'browser config is not supported by this host' }));
        return;
      }
      const session = await resolveSession(req);
      const noUsers = handlers.authStore?.hasUsers?.() !== true;
      if (!noUsers && (!session || browserConfig.isAdmin?.(session.username) !== true)) {
        res.writeHead(403, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'admin session required' }));
        return;
      }
      if ((req.method?.toUpperCase() ?? 'GET') === 'GET') {
        res.writeHead(200, JSON_HEADERS);
        res.end(JSON.stringify(browserConfig.read()));
        return;
      }
      const body = await readJsonBody(req);
      if (!isPlainObject(body) || typeof body.autoOpenBrowser !== 'boolean') {
        res.writeHead(400, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'autoOpenBrowser must be a boolean' }));
        return;
      }
      const saved = browserConfig.write?.(body);
      if (!saved) {
        res.writeHead(501, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'browser config is read-only on this host' }));
        return;
      }
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ ok: true, ...saved }));
      return;
    }

    if (route === 'auth') {
      const authStore = handlers.authStore;
      if (!authStore) {
        res.writeHead(501, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'authentication is not supported by this host' }));
        return;
      }
      const subRoute = pathname.replace(/^\/auth\//, '').replace(/\/+$/, '') || '';
      if (subRoute === 'logout') {
        // Revoke the specific session token, not just clear the cookie. Without
        // this a stolen token stays valid for 7 days because the signature is
        // stateless.
        const secret = handlers.sessionSecret || 'open-code-webui-no-secret';
        const token = getSessionCookie(req.headers?.cookie);
        const session = token ? verifySessionToken(secret, token) : null;
        if (session) {
          revocationStore.revoke(session.jti);
          auditLog.record({
            action: 'logout',
            actor: session.username,
            ip: clientIpOf(req) ?? undefined,
            result: 'allow',
          });
        }
        const trustedDeviceToken = getTrustedDeviceCookie(req.headers?.cookie);
        if (trustedDeviceToken) handlers.trustedDeviceStore?.revoke(trustedDeviceToken);
        clearAuthCookie(res);
        res.writeHead(200, JSON_HEADERS);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (subRoute === 'verify') {
        // The BFF cannot check the signature itself (the secret lives only in
        // this process), so it forwards the browser's session token here. This
        // is what turns the login gate from a cosmetic UI check into a real
        // authorization decision.
        const secret = handlers.sessionSecret || 'open-code-webui-no-secret';
        const body = await readJsonBody(req);
        const token =
          isPlainObject(body) && typeof body.token === 'string'
            ? body.token
            : getSessionCookie(req.headers?.cookie);
        const session = token ? verifySessionToken(secret, token) : null;
        const trustedDeviceToken = isPlainObject(body) && typeof body.trustedDeviceToken === 'string'
          ? body.trustedDeviceToken
          : getTrustedDeviceCookie(req.headers?.cookie);
        const trustedDevice = trustedDeviceToken ? handlers.trustedDeviceStore?.verify(trustedDeviceToken) : null;
        if ((!session || revocationStore.isRevoked(session.jti)) && !trustedDevice) {
          res.writeHead(401, JSON_HEADERS);
          res.end(JSON.stringify({ ok: false, error: 'invalid session' }));
          return;
        }
        res.writeHead(200, JSON_HEADERS);
        const username = trustedDevice?.username ?? session.username;
        res.end(JSON.stringify({ ok: true, username, jti: session?.jti, isAdmin: authStore.isAdmin?.(username) === true }));
        return;
      }
      if (subRoute !== 'login') {
        res.writeHead(404, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'not found' }));
        return;
      }
      const body = await readJsonBody(req);
      const username = isPlainObject(body) && typeof body.username === 'string' ? body.username : '';
      const password = isPlainObject(body) && typeof body.password === 'string' ? body.password : '';
      const trustDevice = isPlainObject(body) && body.trustDevice === true;
      const clientIp = clientIpOf(req);
      if (!username || !password) {
        res.writeHead(400, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'username and password are required' }));
        return;
      }
      // Throttle before touching Windows: every failed ValidateCredentials call
      // counts toward the OS account lockout policy, so an unlimited endpoint
      // would let a LAN client lock the operator out of their own machine.
      // A null IP means "unknown" (no proxy in front), so it is not throttled —
      // otherwise every unproxied client would share a single counter.
      const ipRetryMs = clientIp ? ipThrottle.retryAfterMs(clientIp) : 0;
      const retryAfterMs = Math.max(throttle.retryAfterMs(username), ipRetryMs);
      if (retryAfterMs > 0) {
        const retryAfterSec = Math.ceil(retryAfterMs / 1000);
        auditLog.record({
          action: 'login.throttled',
          actor: username,
          ip: clientIp ?? undefined,
          result: 'deny',
          reason: ipRetryMs > 0 ? 'ip_rate_limit' : 'user_rate_limit',
        });
        res.writeHead(429, { ...JSON_HEADERS, 'Retry-After': String(retryAfterSec) });
        res.end(
          JSON.stringify({
            ok: false,
            error: `試行回数が多すぎます。${retryAfterSec} 秒後に再試行してください`,
            retryAfterSeconds: retryAfterSec,
          }),
        );
        return;
      }

      // Local users.json first: it is cheap and carries no lockout risk.
      let source = null;
      if (authStore.verifyUser(username, password)) {
        source = 'local';
      } else if (
        authStore.readConfig?.().windowsAuth === true &&
        authStore.verifyWindowsUser
      ) {
        try {
          if (await authStore.verifyWindowsUser(username, password)) {
            source = 'windows';
          }
        } catch {
          // Treat a validator crash as a failed login, never as a pass.
          source = null;
        }
      }

      if (!source) {
        throttle.recordFailure(username);
        if (clientIp) ipThrottle.recordFailure(clientIp);
        auditLog.record({
          action: 'login.failure',
          actor: username,
          ip: clientIp ?? undefined,
          result: 'deny',
          reason: 'invalid_credentials',
        });
        res.writeHead(401, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'invalid credentials' }));
        return;
      }

      throttle.reset(username);
      // The IP counter is deliberately NOT reset: one successful login must not
      // wipe the evidence of failed attempts against other accounts from the
      // same address, which would make the per-IP limit trivial to bypass.
      auditLog.record({
        action: 'login.success',
        actor: username,
        ip: clientIp ?? undefined,
        result: 'allow',
        reason: source,
      });
      const secret = handlers.sessionSecret || 'open-code-webui-no-secret';
      const token = trustDevice ? handlers.trustedDeviceStore?.issue(username) : null;
      const cookie = token ? trustedDeviceCookieHeader(token) : authCookieHeader(signSessionToken(secret, username));
      res.writeHead(200, { ...JSON_HEADERS, 'Set-Cookie': cookie });
      res.end(JSON.stringify({ ok: true, username, source, trustedDevice: Boolean(token) }));
      return;
    }

    // Acknowledge before killing WebUI so the caller can flush the response.
    res.writeHead(202, JSON_HEADERS);
    res.end(JSON.stringify({ ok: true, target: route, accepted: true }));

    const run =
      route === 'webui'
        ? handlers.onRestartWebui
        : route === 'opencode'
          ? handlers.onRestartOpencode
          : handlers.onRestartAll;

    setImmediate(() => {
      Promise.resolve()
        .then(() => run())
        .catch(() => {
          // Errors are logged by the host restart functions.
        });
    });
  };
}

/**
 * Localhost-only control plane for tray / WebUI restart actions.
 * @param {{
 *   onRestartWebui: () => Promise<void> | void,
 *   onRestartOpencode: () => Promise<void> | void,
 *   onRestartAll: () => Promise<void> | void,
 *   onStopWebui?: () => Promise<void> | void,
 *   onVoiceInput?: () => Promise<void> | void,
 *   onGetLogs?: (since: number | null) => { entries: unknown[], nextSeq: number },
 *   onAllowFirewall?: () => Promise<Record<string, unknown> | void> | Record<string, unknown> | void,
 *   authStore?: AuthStore,
 *   sessionSecret?: string,
 *   loginThrottle?: ReturnType<typeof createLoginThrottle>,
 *   ipThrottle?: ReturnType<typeof createLoginThrottle>,
 *   controlPort?: number,
 *   revocationStore?: ReturnType<typeof createRevocationStore>,
 *   auditLog?: { record: (event: object) => void },
 * }} handlers
 */
export function createControlServer(handlers) {
  const handle = createControlRequestHandler(handlers);
  return http.createServer((req, res) => {
    void handle(req, res);
  });
}

/**
 * @param {import('http').Server} server
 * @param {number} port
 * @returns {Promise<void>}
 */
export function listenControlServer(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/**
 * @param {import('http').Server | null} server
 * @returns {Promise<void>}
 */
export function closeControlServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
