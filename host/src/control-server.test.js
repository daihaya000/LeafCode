import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlRequestHandler, matchControlRoute } from './control-server.js';

function fakeResponse() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
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
