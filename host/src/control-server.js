import { createHmac, timingSafeEqual } from 'crypto';
import http from 'http';
import { createLoginThrottle } from './windows-auth.js';

/**
 * Match a host-control HTTP route.
 * @param {string} method
 * @param {string} pathname
 * @returns {'webui' | 'opencode' | 'all' | 'health' | 'stop-webui' | 'voice-input' | 'logs' | 'allow-firewall' | 'users' | 'auth' | 'auth-config' | null}
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
  if (m === 'POST' && path === '/auth/login') return 'auth';
  if (m === 'POST' && path === '/auth/logout') return 'auth';
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
 * @param {string} secret
 * @param {string} username
 * @returns {string}
 */
function signSessionToken(secret, username) {
  const payload = `${username}:${Date.now()}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

/**
 * Verify a session token and return the username if valid.
 * @param {string} secret
 * @param {string} token
 * @returns {string | null}
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
  const colon = payload.indexOf(':');
  if (colon === -1) return null;
  const ts = Number(payload.slice(colon + 1));
  if (!Number.isFinite(ts)) return null;
  // 7-day session
  if (Date.now() - ts > 7 * 24 * 60 * 60 * 1000) return null;
  return payload.slice(0, colon);
}

function setAuthCookie(res, token) {
  res.setHeader('Set-Cookie', `webui_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', 'webui_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
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
 * }} handlers
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => Promise<void>}
 */
export function createControlRequestHandler(handlers) {
  // Shared across requests so a brute-force attempt cannot reset its own count.
  const throttle = handlers.loginThrottle ?? createLoginThrottle();

  return async (req, res) => {
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
      if (method === 'DELETE') {
        const body = await readJsonBody(req);
        const username = isPlainObject(body) && typeof body.username === 'string' ? body.username : '';
        if (!username) {
          res.writeHead(400, JSON_HEADERS);
          res.end(JSON.stringify({ ok: false, error: 'username is required' }));
          return;
        }
        const result = authStore.deleteUser(username);
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
      const result = authStore.upsertUser(username, password);
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
      // POST
      if (!authStore.writeConfig) {
        res.writeHead(501, JSON_HEADERS);
        res.end(
          JSON.stringify({ ok: false, error: 'auth config is read-only on this host' }),
        );
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

    if (route === 'auth') {
      const authStore = handlers.authStore;
      if (!authStore) {
        res.writeHead(501, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'authentication is not supported by this host' }));
        return;
      }
      const subRoute = pathname.replace(/^\/auth\//, '') || '';
      if (subRoute === 'logout') {
        clearAuthCookie(res);
        res.writeHead(200, JSON_HEADERS);
        res.end(JSON.stringify({ ok: true }));
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
      if (!username || !password) {
        res.writeHead(400, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'username and password are required' }));
        return;
      }
      // Throttle before touching Windows: every failed ValidateCredentials call
      // counts toward the OS account lockout policy, so an unlimited endpoint
      // would let a LAN client lock the operator out of their own machine.
      const retryAfterMs = throttle.retryAfterMs(username);
      if (retryAfterMs > 0) {
        const retryAfterSec = Math.ceil(retryAfterMs / 1000);
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
        res.writeHead(401, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'invalid credentials' }));
        return;
      }

      throttle.reset(username);
      const secret = handlers.sessionSecret || 'open-code-webui-no-secret';
      const token = signSessionToken(secret, username);
      res.writeHead(200, {
        ...JSON_HEADERS,
        'Set-Cookie': `webui_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`,
      });
      res.end(JSON.stringify({ ok: true, username, source }));
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
