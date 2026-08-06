import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { createControlRequestHandler, matchControlRoute } from './control-server.js';

/**
 * Minimal IncomingMessage-like readable for tests. The control server reads
 * JSON bodies by attaching data/end listeners, so an EventEmitter that emits
 * the body buffer and then 'end' is sufficient.
 */
class MockReadable extends EventEmitter {
  constructor(body = '') {
    super();
    this.body = Buffer.from(body);
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
  const pending = handle({ method: 'POST', url: '/stop/webui' }, res);
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
  await handle({ method: 'POST', url: '/stop/webui' }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { ok: false, error: 'port still busy' });
});

test('POST /stop/webui reports 501 when the host cannot stop the WebUI', async () => {
  const handle = createControlRequestHandler(noopHandlers);
  const res = fakeResponse();
  await handle({ method: 'POST', url: '/stop/webui' }, res);
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
  await handle({ method: 'POST', url: '/voice-input' }, res);
  assert.equal(launched, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, target: 'voice-input', launched: true });
});

test('POST /voice-input reports 501 when unsupported by host', async () => {
  const handle = createControlRequestHandler(noopHandlers);
  const res = fakeResponse();
  await handle({ method: 'POST', url: '/voice-input' }, res);
  assert.equal(res.statusCode, 501);
  assert.equal(res.body.ok, false);
});

test('POST /allow-firewall reports success with the handler result', async () => {
  const handle = createControlRequestHandler({
    ...noopHandlers,
    onAllowFirewall: async () => ({ alreadyExists: false, port: 3000 }),
  });
  const res = fakeResponse();
  await handle({ method: 'POST', url: '/allow-firewall' }, res);
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
  await handle({ method: 'POST', url: '/allow-firewall' }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { ok: false, error: 'UAC cancelled' });
});

test('POST /allow-firewall reports 501 when unsupported by host', async () => {
  const handle = createControlRequestHandler(noopHandlers);
  const res = fakeResponse();
  await handle({ method: 'POST', url: '/allow-firewall' }, res);
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
  await handle({ method: 'POST', url: '/restart/webui' }, res);
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
  await handle({ method: 'GET', url: '/logs?since=5' }, res);
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
  await handle({ method: 'GET', url: '/logs' }, res);
  assert.equal(receivedSince, null);
});

test('GET /logs reports 501 when unsupported by host', async () => {
  const handle = createControlRequestHandler(noopHandlers);
  const res = fakeResponse();
  await handle({ method: 'GET', url: '/logs' }, res);
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
  await handle({ method: 'GET', url: '/users' }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { users: [{ username: 'alice', updatedAt: '2026-01-01' }] });
});

test('POST /users upserts a user', async () => {
  let upserted = null;
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: {
      listUsers: () => [],
      verifyUser: () => false,
      upsertUser: (username, password) => {
        upserted = { username, password };
        return { ok: true };
      },
      deleteUser: () => ({ ok: false, error: 'unsupported' }),
      hasUsers: () => true,
    },
  });
  const res = fakeResponse();
  const req = new MockReadable(JSON.stringify({ username: 'alice', password: 'secret' }));
  req.method = 'POST';
  req.url = '/users';
  await handle(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(upserted, { username: 'alice', password: 'secret' });
});

test('DELETE /users removes a user', async () => {
  let deleted = null;
  const handle = createControlRequestHandler({
    ...noopHandlers,
    authStore: {
      listUsers: () => [],
      verifyUser: () => false,
      upsertUser: () => ({ ok: false, error: 'unsupported' }),
      deleteUser: (username) => {
        deleted = username;
        return { ok: true };
      },
      hasUsers: () => false,
    },
  });
  const res = fakeResponse();
  const req = new MockReadable(JSON.stringify({ username: 'alice' }));
  req.method = 'DELETE';
  req.url = '/users';
  await handle(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(deleted, 'alice');
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

test('health and unknown routes are unchanged', async () => {
  const handle = createControlRequestHandler(noopHandlers);
  const health = fakeResponse();
  await handle({ method: 'GET', url: '/health' }, health);
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.body, { ok: true, service: 'opencode-webui-host' });

  const missing = fakeResponse();
  await handle({ method: 'POST', url: '/nope' }, missing);
  assert.equal(missing.statusCode, 404);
});
