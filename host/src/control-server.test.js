import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import { EventEmitter } from 'events';
import { readFileSync, rmSync } from 'fs';
import { join } from 'path';
import {
  createControlRequestHandler,
  createRevocationStore,
  isLoopbackHostHeader,
  matchControlRoute,
} from './control-server.js';
import { createLoginThrottle } from './windows-auth.js';

/**
 * Minimal IncomingMessage-like readable for tests. The control server reads
 * JSON bodies by attaching data/end listeners, so an EventEmitter that emits
 * the body buffer and then 'end' is sufficient.
 */
class MockReadable extends EventEmitter {
  constructor(body = '', headers = {}) {
    super();
    this.body = Buffer.from(body);
    this.headers = { host: '127.0.0.1:18765', ...headers };
  }

  on(event, listener) {
    super.on(event, listener);
    if (event === 'data') {
      // Emit asynchronously so listeners are attached before data arrives.
      setImmediate(() => listener(this.body));
    }
    if (event === 'end') {
      setImmediate(() => listener());
    }
    return this;
  }
}

function fakeResponse() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers || {};
    },
    setHeader(name, value) {
      if (!this.headers) this.headers = {};
      this.headers[name] = value;
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null;
    },
  };
}

const noopHandlers = {
  onRestartWebui: () => {},
  onRestartOpencode: () => {},
  onRestartAll: () => {},
};

test('matchControlRoute maps restart endpoints', () => {
  assert.equal(matchControlRoute('POST', '/restart/webui'), 'webui');
  assert.equal(matchControlRoute('POST', '/restart/opencode'), 'opencode');
  assert.equal(matchControlRoute('POST', '/restart/all'), 'all');
  assert.equal(matchControlRoute('POST', '/restart/webui/'), 'webui');
});

test('matchControlRoute exposes health and rejects unknowns', () => {
  assert.equal(matchControlRoute('GET', '/health'), 'health');
  assert.equal(matchControlRoute('GET', '/restart/webui'), null);
  assert.equal(matchControlRoute('POST', '/restart'), null);
  assert.equal(matchControlRoute('DELETE', '/restart/all'), null);
});

test('matchControlRoute maps the build stop endpoint', () => {
  assert.equal(matchControlRoute('POST', '/stop/webui'), 'stop-webui');
  assert.equal(matchControlRoute('post', '/stop/webui/'), 'stop-webui');
  assert.equal(matchControlRoute('GET', '/stop/webui'), null);
  assert.equal(matchControlRoute('POST', '/stop'), null);
  assert.equal(matchControlRoute('POST', '/stop/opencode'), null);
});

test('matchControlRoute maps the voice input endpoint', () => {
  assert.equal(matchControlRoute('POST', '/voice-input'), 'voice-input');
  assert.equal(matchControlRoute('post', '/voice-input/'), 'voice-input');
  assert.equal(matchControlRoute('GET', '/voice-input'), null);
});

test('matchControlRoute maps the allow-firewall endpoint', () => {
  assert.equal(matchControlRoute('POST', '/allow-firewall'), 'allow-firewall');
  assert.equal(matchControlRoute('post', '/allow-firewall/'), 'allow-firewall');
  assert.equal(matchControlRoute('GET', '/allow-firewall'), null);
});

test('matchControlRoute maps the logs endpoint (GET only)', () => {
  assert.equal(matchControlRoute('GET', '/logs'), 'logs');
  assert.equal(matchControlRoute('get', '/logs/'), 'logs');
  assert.equal(matchControlRoute('POST', '/logs'), null);
});

test('POST /stop/webui answers only after the stop finished', async () => {
  const events = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const handle = createControlRequestHandler({
    ...noopHandlers,
    onStopWebui: async () => {
      events.push('stop-start');
      await gate;
      events.push('stop-done');
    },
  });

  const res = fakeResponse();
  const pending = handle({ method: 'POST', url: '/stop/webui', headers: { host: '127.0.0.1:18765' } }, res);
  await Promise.resolve();
  assert.equal(res.statusCode, null, 'must not respond before the stop completes');
  release();
  await pending;

  assert.deepEqual(events, ['stop-start', 'stop-done']);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, target: 'webui', stopped: true });
});

test('POST /stop/webui reports a failed stop with 500', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    onStopWebui: async () => {
      throw new Error('port still busy');
    },
  });
  const res = fakeResponse();
  await handle({ method: 'POST', url: '/stop/webui', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { ok: false, error: 'port still busy' });
});

test('POST /stop/webui reports 501 when the host cannot stop the WebUI', async () => {
  const handle = createControlRequestHandler(noopHandlers);
  const res = fakeResponse();
  await handle({ method: 'POST', url: '/stop/webui', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(res.statusCode, 501);
  assert.equal(res.body.ok, false);
});

test('POST /voice-input launches Windows voice input', async () => {
  let launched = false;
  const handle = createControlRequestHandler({
    ...noopHandlers,
    onVoiceInput: () => {
      launched = true;
    },
  });
  const res = fakeResponse();
  await handle({ method: 'POST', url: '/voice-input', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(launched, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, target: 'voice-input', launched: true });
});

test('POST /voice-input reports 501 when unsupported by host', async () => {
  const handle = createControlRequestHandler(noopHandlers);
  const res = fakeResponse();
  await handle({ method: 'POST', url: '/voice-input', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(res.statusCode, 501);
  assert.equal(res.body.ok, false);
});

test('POST /allow-firewall reports success with the handler result', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    onAllowFirewall: async () => ({ alreadyExists: false, port: 3000 }),
  });
  const res = fakeResponse();
  await handle({ method: 'POST', url: '/allow-firewall', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    target: 'allow-firewall',
    alreadyExists: false,
    port: 3000,
  });
});

test('POST /allow-firewall reports a failure (e.g. UAC cancelled) with 500', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    onAllowFirewall: async () => {
      throw new Error('UAC cancelled');
    },
  });
  const res = fakeResponse();
  await handle({ method: 'POST', url: '/allow-firewall', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { ok: false, error: 'UAC cancelled' });
});

test('POST /allow-firewall reports 501 when unsupported by host', async () => {
  const handle = createControlRequestHandler(noopHandlers);
  const res = fakeResponse();
  await handle({ method: 'POST', url: '/allow-firewall', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(res.statusCode, 501);
  assert.equal(res.body.ok, false);
});

test('restart routes keep answering 202 before the work runs', async () => {
  let restarted = false;
  const handle = createControlRequestHandler({
    ...noopHandlers,
    onRestartWebui: () => {
      restarted = true;
    },
  });
  const res = fakeResponse();
  await handle({ method: 'POST', url: '/restart/webui', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.body, { ok: true, target: 'webui', accepted: true });
  assert.equal(restarted, false, 'restart is scheduled after the response');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(restarted, true);
});

test('GET /logs returns entries and nextSeq from the handler', async () => {
  let receivedSince = 'not-called';
  const handle = createControlRequestHandler({
    ...noopHandlers,
    onGetLogs: (since) => {
      receivedSince = since;
      return { entries: [{ seq: 1, ts: 1, source: 'host', level: 'log', text: 'hi' }], nextSeq: 1 };
    },
  });
  const res = fakeResponse();
  await handle({ method: 'GET', url: '/logs?since=5', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(receivedSince, 5);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    entries: [{ seq: 1, ts: 1, source: 'host', level: 'log', text: 'hi' }],
    nextSeq: 1,
  });
});

test('GET /logs with no since query passes null to the handler', async () => {
  let receivedSince = 'not-called';
  const handle = createControlRequestHandler({
    ...noopHandlers,
    onGetLogs: (since) => {
      receivedSince = since;
      return { entries: [], nextSeq: 0 };
    },
  });
  const res = fakeResponse();
  await handle({ method: 'GET', url: '/logs', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(receivedSince, null);
});

test('GET /logs reports 501 when unsupported by host', async () => {
  const handle = createControlRequestHandler(noopHandlers);
  const res = fakeResponse();
  await handle({ method: 'GET', url: '/logs', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(res.statusCode, 501);
  assert.equal(res.body.ok, false);
});

test('matchControlRoute maps user management and auth endpoints', () => {
  assert.equal(matchControlRoute('GET', '/users'), 'users');
  assert.equal(matchControlRoute('POST', '/users'), 'users');
  assert.equal(matchControlRoute('DELETE', '/users'), 'users');
  assert.equal(matchControlRoute('POST', '/auth/login'), 'auth');
  assert.equal(matchControlRoute('POST', '/auth/logout'), 'auth');
  assert.equal(matchControlRoute('GET', '/auth/login'), null);
  assert.equal(matchControlRoute('POST', '/auth/verify'), 'auth');
  assert.equal(matchControlRoute('GET', '/auth/verify'), null);
  assert.equal(matchControlRoute('GET', '/auth/config'), 'auth-config');
  assert.equal(matchControlRoute('POST', '/auth/config'), 'auth-config');
  assert.equal(matchControlRoute('DELETE', '/auth/config'), null);
});

test('GET /users returns users from the auth store', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: {
      listUsers: () => [{ username: 'alice', updatedAt: '2026-01-01' }],
      verifyUser: () => false,
      upsertUser: () => ({ ok: false, error: 'unsupported' }),
      deleteUser: () => ({ ok: false, error: 'unsupported' }),
      hasUsers: () => true,
    },
  });
  const res = fakeResponse();
  await handle({ method: 'GET', url: '/users', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { users: [{ username: 'alice', updatedAt: '2026-01-01' }] });
});

test('POST /users upserts a user', async () => {
  let upserted = null;
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({
      upsertUser: (username, password) => {
        upserted = { username, password };
        return { ok: true };
      },
    }),
    sessionSecret: 'test-secret',
  });
  const cookie = await adminCookie(handle);
  const res = await postJson(handle, '/users', { username: 'alice', password: 'secret' }, cookie);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(upserted, { username: 'alice', password: 'secret' });
});

test('DELETE /users removes a user', async () => {
  let deleted = null;
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({
      deleteUser: (username) => {
        deleted = username;
        return { ok: true };
      },
      hasUsers: () => false,
    }),
    sessionSecret: 'test-secret',
  });
  const cookie = await adminCookie(handle);
  const res = fakeResponse();
  const req = new MockReadable(JSON.stringify({ username: 'alice' }), cookie);
  req.method = 'DELETE';
  req.url = '/users';
  await handle(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(deleted, 'alice');
});

test('POST /users rejects a request with no session at all', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub(),
    sessionSecret: 'test-secret',
  });
  const res = await postJson(handle, '/users', { username: 'mallory', password: 'pw' });
  assert.equal(res.statusCode, 403);
});

test('POST /users rejects a non-admin session', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({ isAdmin: () => false }),
    sessionSecret: 'test-secret',
  });
  const cookie = await adminCookie(handle);
  const res = await postJson(handle, '/users', { username: 'mallory', password: 'pw' }, cookie);
  assert.equal(res.statusCode, 403);
});

test('DELETE /users rejects a non-admin session', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({ isAdmin: () => false }),
    sessionSecret: 'test-secret',
  });
  const cookie = await adminCookie(handle);
  const res = fakeResponse();
  const req = new MockReadable(JSON.stringify({ username: 'alice' }), cookie);
  req.method = 'DELETE';
  req.url = '/users';
  await handle(req, res);
  assert.equal(res.statusCode, 403);
});

test('GET /users remains available without a session (unchanged read-only listing)', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({ listUsers: () => [{ username: 'alice', role: 'admin', updatedAt: 'x' }] }),
    sessionSecret: 'test-secret',
  });
  const res = fakeResponse();
  await handle({ method: 'GET', url: '/users', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(res.statusCode, 200);
});

test('POST /auth/login sets a session cookie on success', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: {
      listUsers: () => [],
      verifyUser: (username, password) => username === 'alice' && password === 'secret',
      upsertUser: () => ({ ok: false, error: 'unsupported' }),
      deleteUser: () => ({ ok: false, error: 'unsupported' }),
      hasUsers: () => true,
    },
    sessionSecret: 'test-secret',
  });
  const res = fakeResponse();
  const req = new MockReadable(JSON.stringify({ username: 'alice', password: 'secret' }));
  req.method = 'POST';
  req.url = '/auth/login';
  await handle(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.headers?.['Set-Cookie']?.includes('webui_session='));
});

test('POST /auth/login rejects bad credentials', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: {
      listUsers: () => [],
      verifyUser: () => false,
      upsertUser: () => ({ ok: false, error: 'unsupported' }),
      deleteUser: () => ({ ok: false, error: 'unsupported' }),
      hasUsers: () => true,
    },
    sessionSecret: 'test-secret',
  });
  const res = fakeResponse();
  const req = new MockReadable(JSON.stringify({ username: 'alice', password: 'wrong' }));
  req.method = 'POST';
  req.url = '/auth/login';
  await handle(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
});

/** Auth store stub with everything disabled unless overridden. */
function authStoreStub(overrides = {}) {
  return {
    listUsers: () => [],
    // Matches the password used by loginForToken's default args, so tests that
    // need an admin session can call adminCookie(handle) without overriding this.
    verifyUser: (username, password) => password === 'secret',
    upsertUser: () => ({ ok: false, error: 'unsupported' }),
    deleteUser: () => ({ ok: false, error: 'unsupported' }),
    hasUsers: () => true,
    isAdmin: () => true,
    readConfig: () => ({ windowsAuth: false }),
    writeConfig: (patch) => ({ windowsAuth: patch.windowsAuth === true }),
    windowsAuthSupported: true,
    ...overrides,
  };
}

async function postJson(handle, url, body, headers = {}) {
  const res = fakeResponse();
  const req = new MockReadable(JSON.stringify(body), headers);
  req.method = 'POST';
  req.url = url;
  await handle(req, res);
  return res;
}

/** Cookie header for a logged-in admin session. */
async function adminCookie(handle) {
  const token = await loginForToken(handle);
  return { cookie: `webui_session=${encodeURIComponent(token)}` };
}

test('POST /auth/login falls back to Windows when the local store misses', async () => {
  const seen = [];
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({
      readConfig: () => ({ windowsAuth: true }),
      verifyWindowsUser: async (username, password) => {
        seen.push({ username, password });
        return username === 'Daichi' && password === 'winpass';
      },
    }),
    sessionSecret: 'test-secret',
  });

  const res = await postJson(handle, '/auth/login', {
    username: 'Daichi',
    password: 'winpass',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.source, 'windows');
  assert.deepEqual(seen, [{ username: 'Daichi', password: 'winpass' }]);
});

test('POST /auth/login reports the local store as the source and skips Windows', async () => {
  let windowsCalled = false;
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({
      verifyUser: (u, p) => u === 'alice' && p === 'secret',
      readConfig: () => ({ windowsAuth: true }),
      verifyWindowsUser: async () => {
        windowsCalled = true;
        return true;
      },
    }),
    sessionSecret: 'test-secret',
  });

  const res = await postJson(handle, '/auth/login', {
    username: 'alice',
    password: 'secret',
  });
  assert.equal(res.body.source, 'local');
  assert.equal(windowsCalled, false, 'local success must not trigger a Windows logon attempt');
});

test('POST /auth/login never tries Windows while the flag is off', async () => {
  let windowsCalled = false;
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({
      readConfig: () => ({ windowsAuth: false }),
      verifyWindowsUser: async () => {
        windowsCalled = true;
        return true;
      },
    }),
    sessionSecret: 'test-secret',
  });

  const res = await postJson(handle, '/auth/login', {
    username: 'Daichi',
    password: 'winpass',
  });
  assert.equal(res.statusCode, 401);
  assert.equal(windowsCalled, false);
});

test('POST /auth/login treats a Windows validator crash as a failed login', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({
      readConfig: () => ({ windowsAuth: true }),
      verifyWindowsUser: async () => {
        throw new Error('powershell exploded');
      },
    }),
    sessionSecret: 'test-secret',
  });

  const res = await postJson(handle, '/auth/login', {
    username: 'Daichi',
    password: 'winpass',
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
});

test('POST /auth/login throttles repeated failures with 429 and Retry-After', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub(),
    sessionSecret: 'test-secret',
    loginThrottle: createLoginThrottle({ maxAttempts: 3, windowMs: 60_000 }),
  });

  for (let i = 0; i < 3; i += 1) {
    const res = await postJson(handle, '/auth/login', { username: 'alice', password: 'no' });
    assert.equal(res.statusCode, 401, `attempt ${i + 1} should still be evaluated`);
  }

  const blocked = await postJson(handle, '/auth/login', { username: 'alice', password: 'no' });
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers?.['Retry-After']) > 0);
  assert.ok(blocked.body.retryAfterSeconds > 0);
});

test('POST /auth/login throttling stops Windows logons, protecting the OS lockout counter', async () => {
  let windowsAttempts = 0;
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({
      readConfig: () => ({ windowsAuth: true }),
      verifyWindowsUser: async () => {
        windowsAttempts += 1;
        return false;
      },
    }),
    sessionSecret: 'test-secret',
    loginThrottle: createLoginThrottle({ maxAttempts: 2, windowMs: 60_000 }),
  });

  for (let i = 0; i < 6; i += 1) {
    await postJson(handle, '/auth/login', { username: 'Daichi', password: 'guess' });
  }
  assert.equal(windowsAttempts, 2, 'Windows must not see more attempts than the throttle allows');
});

test('POST /auth/login throttles per username', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub(),
    sessionSecret: 'test-secret',
    loginThrottle: createLoginThrottle({ maxAttempts: 1, windowMs: 60_000 }),
  });

  await postJson(handle, '/auth/login', { username: 'alice', password: 'no' });
  const aliceBlocked = await postJson(handle, '/auth/login', { username: 'alice', password: 'no' });
  assert.equal(aliceBlocked.statusCode, 429);

  const bob = await postJson(handle, '/auth/login', { username: 'bob', password: 'no' });
  assert.equal(bob.statusCode, 401, 'a different user must not inherit the block');
});

test('POST /auth/login clears the throttle after a success', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({
      verifyUser: (u, p) => p === 'right',
    }),
    sessionSecret: 'test-secret',
    loginThrottle: createLoginThrottle({ maxAttempts: 2, windowMs: 60_000 }),
  });

  await postJson(handle, '/auth/login', { username: 'alice', password: 'no' });
  const ok = await postJson(handle, '/auth/login', { username: 'alice', password: 'right' });
  assert.equal(ok.statusCode, 200);

  // The earlier failure must not count toward a later block.
  await postJson(handle, '/auth/login', { username: 'alice', password: 'no' });
  const stillEvaluated = await postJson(handle, '/auth/login', {
    username: 'alice',
    password: 'no',
  });
  assert.equal(stillEvaluated.statusCode, 401);
});

/** Log in and return the session token the host issued via Set-Cookie. */
async function loginForToken(handle, username = 'alice', password = 'secret') {
  const res = await postJson(handle, '/auth/login', { username, password });
  assert.equal(res.statusCode, 200, 'login must succeed to yield a token');
  const cookie = res.headers?.['Set-Cookie'] ?? '';
  const match = /webui_session=([^;]+)/.exec(cookie);
  assert.ok(match, `no session cookie in ${cookie}`);
  return decodeURIComponent(match[1]);
}

function verifyHandler(secret = 'test-secret', overrides = {}, revocationStore) {
  return createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({ verifyUser: (u, p) => p === 'secret', ...overrides }),
    sessionSecret: secret,
    // In-memory only, so tests never touch the real %APPDATA% revocation file.
    revocationStore: revocationStore ?? createRevocationStore({ persist: false }),
  });
}

test('POST /auth/verify accepts a token this host issued', async () => {
  const handle = verifyHandler();
  const token = await loginForToken(handle);

  const res = await postJson(handle, '/auth/verify', { token });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.username, 'alice');
  assert.ok(typeof res.body.jti === 'string' && res.body.jti.length > 0);
  assert.equal(res.body.isAdmin, true);
});

test('POST /auth/verify reads the token from a Cookie header too', async () => {
  const handle = verifyHandler();
  const token = await loginForToken(handle);

  const res = fakeResponse();
  const req = new MockReadable('{}');
  req.method = 'POST';
  req.url = '/auth/verify';
  req.headers = { host: '127.0.0.1:18765', cookie: `theme=dark; webui_session=${encodeURIComponent(token)}` };
  await handle(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.username, 'alice');
});

test('POST /auth/logout revokes the session so the token cannot be verified again', async () => {
  const handle = verifyHandler();
  const token = await loginForToken(handle);
  assert.equal((await postJson(handle, '/auth/verify', { token })).statusCode, 200);

  const res = fakeResponse();
  const req = new MockReadable('{}', { cookie: `webui_session=${encodeURIComponent(token)}` });
  req.method = 'POST';
  req.url = '/auth/logout';
  await handle(req, res);
  assert.equal(res.statusCode, 200);

  // The stateless HMAC signature is still valid, but the jti is revoked — this
  // is the whole point: a stolen token stays valid for 7 days without this check.
  const stillValid = await postJson(handle, '/auth/verify', { token });
  assert.equal(stillValid.statusCode, 401);
});

test('POST /auth/logout without a session cookie still clears the cookie and succeeds', async () => {
  const handle = verifyHandler();
  const res = fakeResponse();
  const req = new MockReadable('{}');
  req.method = 'POST';
  req.url = '/auth/logout';
  await handle(req, res);
  assert.equal(res.statusCode, 200);
});

test('revoking one session does not invalidate a second session for the same user', async () => {
  const store = createRevocationStore({ persist: false });
  const handle = verifyHandler('test-secret', {}, store);
  const tokenA = await loginForToken(handle);
  const tokenB = await loginForToken(handle);

  const logoutRes = fakeResponse();
  const logoutReq = new MockReadable('{}', { cookie: `webui_session=${encodeURIComponent(tokenA)}` });
  logoutReq.method = 'POST';
  logoutReq.url = '/auth/logout';
  await handle(logoutReq, logoutRes);

  assert.equal((await postJson(handle, '/auth/verify', { token: tokenA })).statusCode, 401);
  assert.equal((await postJson(handle, '/auth/verify', { token: tokenB })).statusCode, 200);
});

test('POST /auth/verify rejects a token signed with a different secret', async () => {
  const token = await loginForToken(verifyHandler('secret-a'));
  // A host restart regenerates the secret, which must invalidate old sessions.
  const res = await postJson(verifyHandler('secret-b'), '/auth/verify', { token });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
});

test('POST /auth/verify rejects a tampered payload', async () => {
  const handle = verifyHandler();
  const token = await loginForToken(handle);
  const [, sig] = token.split('.');
  const forged = `${Buffer.from('admin:' + Date.now()).toString('base64url')}.${sig}`;

  const res = await postJson(handle, '/auth/verify', { token: forged });
  assert.equal(res.statusCode, 401);
});

test('POST /auth/verify rejects missing, empty and malformed tokens', async () => {
  const handle = verifyHandler();
  for (const token of [undefined, '', 'no-dot', 'a.b', '...']) {
    const res = await postJson(handle, '/auth/verify', { token });
    assert.equal(res.statusCode, 401, JSON.stringify(token));
  }
});

test('POST /auth/verify rejects an expired token', async () => {
  const handle = verifyHandler();
  const secret = 'test-secret';
  const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
  const payload = `alice:abcd1234:${eightDaysAgo}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  const stale = `${Buffer.from(payload).toString('base64url')}.${sig}`;

  const res = await postJson(handle, '/auth/verify', { token: stale });
  assert.equal(res.statusCode, 401);
});

test('POST /auth/verify rejects a token dated far in the future', async () => {
  const handle = verifyHandler();
  const secret = 'test-secret';
  // A forged future timestamp must not extend the session window.
  const payload = `alice:abcd1234:${Date.now() + 60 * 60 * 1000}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  const token = `${Buffer.from(payload).toString('base64url')}.${sig}`;

  const res = await postJson(handle, '/auth/verify', { token });
  assert.equal(res.statusCode, 401);
});

test('POST /auth/verify preserves a username containing a colon', async () => {
  // The jti/timestamp are split off the last two colons, so odd usernames survive.
  const secret = 'test-secret';
  const payload = `corp:alice:abcd1234:${Date.now()}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  const token = `${Buffer.from(payload).toString('base64url')}.${sig}`;

  const res = await postJson(verifyHandler(secret), '/auth/verify', { token });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.username, 'corp:alice');
});

test('POST /auth/verify reports 501 when the host has no auth store', async () => {
  const handle = createControlRequestHandler(noopHandlers);
  const res = await postJson(handle, '/auth/verify', { token: 'x' });
  assert.equal(res.statusCode, 501);
});

test('GET /auth/config reports the flag, support and whether users exist', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({
      readConfig: () => ({ windowsAuth: true }),
      hasUsers: () => false,
    }),
  });
  const res = fakeResponse();
  await handle({ method: 'GET', url: '/auth/config', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    windowsAuth: true,
    windowsAuthSupported: true,
    hasUsers: false,
  });
});

test('GET /auth/config does not leak usernames', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({
      listUsers: () => [{ username: 'alice', updatedAt: 'x' }],
      hasUsers: () => true,
    }),
  });
  const res = fakeResponse();
  await handle({ method: 'GET', url: '/auth/config', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(JSON.stringify(res.body).includes('alice'), false);
});

test('POST /auth/config persists the flag', async () => {
  let saved = null;
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({
      writeConfig: (patch) => {
        saved = patch;
        return { windowsAuth: patch.windowsAuth === true };
      },
    }),
    sessionSecret: 'test-secret',
  });
  const cookie = await adminCookie(handle);
  const res = await postJson(handle, '/auth/config', { windowsAuth: true }, cookie);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(saved, { windowsAuth: true });
  assert.equal(res.body.windowsAuth, true);
});

test('POST /auth/config rejects a request with no admin session', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub(),
    sessionSecret: 'test-secret',
  });
  const res = await postJson(handle, '/auth/config', { windowsAuth: true });
  assert.equal(res.statusCode, 403);
});

test('POST /auth/config rejects a non-admin session', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({ isAdmin: () => false }),
    sessionSecret: 'test-secret',
  });
  const cookie = await adminCookie(handle);
  const res = await postJson(handle, '/auth/config', { windowsAuth: true }, cookie);
  assert.equal(res.statusCode, 403);
});

test('POST /auth/config rejects a non-boolean flag', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub(),
    sessionSecret: 'test-secret',
  });
  const cookie = await adminCookie(handle);
  for (const body of [{ windowsAuth: 'yes' }, { windowsAuth: 1 }, {}]) {
    const res = await postJson(handle, '/auth/config', body, cookie);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});

test('POST /auth/config refuses to enable Windows auth on an unsupported OS', async () => {
  let saved = null;
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: authStoreStub({
      windowsAuthSupported: false,
      writeConfig: (patch) => {
        saved = patch;
        return { windowsAuth: patch.windowsAuth === true };
      },
    }),
    sessionSecret: 'test-secret',
  });
  const cookie = await adminCookie(handle);
  const res = await postJson(handle, '/auth/config', { windowsAuth: true }, cookie);
  assert.equal(res.statusCode, 400);
  assert.equal(saved, null);

  // Turning it off must still work, so a config copied from Windows can be cleared.
  const off = await postJson(handle, '/auth/config', { windowsAuth: false }, cookie);
  assert.equal(off.statusCode, 200);
});

test('/auth/config reports 501 when the host has no auth store', async () => {
  const handle = createControlRequestHandler(noopHandlers);
  const res = fakeResponse();
  await handle({ method: 'GET', url: '/auth/config', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(res.statusCode, 501);
});

test('health and unknown routes are unchanged', async () => {
  const handle = createControlRequestHandler(noopHandlers);
  const health = fakeResponse();
  await handle({ method: 'GET', url: '/health', headers: { host: '127.0.0.1:18765' } }, health);
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.body, { ok: true, service: 'opencode-webui-host' });

  const missing = fakeResponse();
  await handle({ method: 'POST', url: '/nope', headers: { host: '127.0.0.1:18765' } }, missing);
  assert.equal(missing.statusCode, 404);
});

test('isLoopbackHostHeader accepts the loopback hostnames with the expected port', () => {
  for (const host of ['127.0.0.1:18765', 'localhost:18765', '[::1]:18765']) {
    assert.equal(isLoopbackHostHeader(host, 18765), true, host);
  }
});

test('isLoopbackHostHeader accepts a host without a port when no expected port is given', () => {
  assert.equal(isLoopbackHostHeader('127.0.0.1'), true);
  assert.equal(isLoopbackHostHeader('localhost'), true);
});

test('isLoopbackHostHeader accepts the host when the port is absent but the hostname is loopback', () => {
  assert.equal(isLoopbackHostHeader('127.0.0.1', 18765), true);
});

test('isLoopbackHostHeader rejects the right hostname on the wrong port', () => {
  assert.equal(isLoopbackHostHeader('127.0.0.1:9999', 18765), false);
});

test('isLoopbackHostHeader rejects a non-loopback hostname (DNS rebinding)', () => {
  for (const host of ['evil.test:18765', '192.168.0.102:18765', 'opencode.local:18765']) {
    assert.equal(isLoopbackHostHeader(host, 18765), false, host);
  }
});

test('isLoopbackHostHeader rejects an empty or malformed header', () => {
  assert.equal(isLoopbackHostHeader(undefined), false);
  assert.equal(isLoopbackHostHeader(''), false);
  assert.equal(isLoopbackHostHeader('[::1'), false);
});

test('isLoopbackHostHeader rejects a header given as a list whose first element is not loopback', () => {
  assert.equal(isLoopbackHostHeader(['evil.test:18765'], 18765), false);
});

test('createRevocationStore (in-memory) starts with nothing revoked', () => {
  const store = createRevocationStore({ persist: false });
  assert.equal(store.isRevoked('anything'), false);
});

test('createRevocationStore (in-memory) tracks a revoked jti', () => {
  const store = createRevocationStore({ persist: false });
  store.revoke('jti-1');
  assert.equal(store.isRevoked('jti-1'), true);
  assert.equal(store.isRevoked('jti-2'), false);
});

test('createRevocationStore (in-memory) ignores a falsy jti', () => {
  const store = createRevocationStore({ persist: false });
  store.revoke('');
  store.revoke(undefined);
  assert.equal(store.isRevoked(''), false);
  assert.equal(store.isRevoked(undefined), false);
});

test('createRevocationStore (in-memory) does not persist across instances', () => {
  const a = createRevocationStore({ persist: false });
  a.revoke('jti-1');
  const b = createRevocationStore({ persist: false });
  assert.equal(b.isRevoked('jti-1'), false);
});

test('createRevocationStore (persisted) survives a fresh instance, e.g. a host restart', () => {
  const testDir = 'C:\\tmp-revocation-test-' + Date.now();
  const original = process.env.APPDATA;
  process.env.APPDATA = testDir;
  try {
    const a = createRevocationStore();
    a.revoke('jti-1');
    const b = createRevocationStore();
    assert.equal(b.isRevoked('jti-1'), true);
  } finally {
    process.env.APPDATA = original;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('createRevocationStore (persisted) does not reset an older jti timestamp when a newer one is revoked', () => {
  const testDir = 'C:\\tmp-revocation-test-' + Date.now();
  const original = process.env.APPDATA;
  process.env.APPDATA = testDir;
  try {
    const a = createRevocationStore();
    a.revoke('old-jti');
    const fileBefore = readFileSync(
      join(testDir, 'opencode-webui', 'revoked-sessions.json'),
      'utf8',
    );
    const tsBefore = JSON.parse(fileBefore).find((e) => e.jti === 'old-jti').ts;

    // A later revocation must not rewrite the earlier entry's timestamp: doing
    // so would make every entry look freshly revoked forever, so the file
    // would never prune old entries.
    a.revoke('new-jti');
    const fileAfter = readFileSync(
      join(testDir, 'opencode-webui', 'revoked-sessions.json'),
      'utf8',
    );
    const tsAfter = JSON.parse(fileAfter).find((e) => e.jti === 'old-jti').ts;
    assert.equal(tsAfter, tsBefore);
  } finally {
    process.env.APPDATA = original;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('control server rejects a DNS-rebinding Host before any route is matched', async () => {
  const handle = createControlRequestHandler({ ...noopHandlers, controlPort: 18765 });
  const res = fakeResponse();
  await handle({ method: 'GET', url: '/health', headers: { host: 'evil.test:18765' } }, res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /loopback/);
});

test('control server rejects a missing Host header', async () => {
  const handle = createControlRequestHandler({ ...noopHandlers, controlPort: 18765 });
  const res = fakeResponse();
  await handle({ method: 'GET', url: '/health' }, res);
  assert.equal(res.statusCode, 403);
});

test('control server accepts the correct port on a loopback host', async () => {
  const handle = createControlRequestHandler({ ...noopHandlers, controlPort: 18765 });
  const res = fakeResponse();
  await handle({ method: 'GET', url: '/health', headers: { host: '127.0.0.1:18765' } }, res);
  assert.equal(res.statusCode, 200);
});

test('control server rejects a loopback host on the wrong port', async () => {
  const handle = createControlRequestHandler({ ...noopHandlers, controlPort: 18765 });
  const res = fakeResponse();
  await handle({ method: 'GET', url: '/health', headers: { host: '127.0.0.1:9999' } }, res);
  assert.equal(res.statusCode, 403);
});

test('control server does not leak route existence for an unknown path on a rebinding host', async () => {
  const handle = createControlRequestHandler({ ...noopHandlers, controlPort: 18765 });
  const res = fakeResponse();
  await handle({ method: 'POST', url: '/nope', headers: { host: 'evil.test:18765' } }, res);
  assert.equal(res.statusCode, 403);
});

test('control server does not let POST /users through from a rebinding host', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    controlPort: 18765,
    authStore: authStoreStub(),
  });
  const res = fakeResponse();
  const req = new MockReadable(JSON.stringify({ username: 'mallory', password: 'pw' }), {
    host: 'evil.test:18765',
  });
  req.method = 'POST';
  req.url = '/users';
  await handle(req, res);
  assert.equal(res.statusCode, 403);
});
