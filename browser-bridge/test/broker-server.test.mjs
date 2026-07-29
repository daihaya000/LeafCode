import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createBrowserBridgeBroker } from '../broker/server.mjs';

async function startBroker() {
  const broker = createBrowserBridgeBroker({
    internalToken: randomBytes(32).toString('base64url'),
    WebSocketServer: (await import('ws')).WebSocketServer,
    pairingTtlMs: 500,
  });
  await broker.listen(0);
  return broker;
}

test('internal endpoints are loopback-only and require the generated bearer token', async (t) => {
  const broker = await startBroker();
  t.after(() => broker.close());

  const denied = await fetch(`${broker.url}/internal/status`);
  assert.equal(denied.status, 401);

  const allowed = await fetch(`${broker.url}/internal/status`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  });
  assert.equal(allowed.status, 200);
  const status = await allowed.json();
  assert.deepEqual(status, { extension: { connected: false, paired: false }, pendingApprovals: 0 });
  assert.equal(JSON.stringify(status).includes(broker.internalToken), false);

  const toolStatus = await fetch(`${broker.url}/internal/tools/browser_status`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(toolStatus.status, 200);
  assert.deepEqual(await toolStatus.json(), status);

  const unavailable = await fetch(`${broker.url}/internal/tools/browser_snapshot`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tabId: 'tab_1' }),
  });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: { code: 'EXTENSION_DISCONNECTED' },
  });
});

test('pairs only a Chrome extension origin and uses one-time pairing codes', async (t) => {
  const broker = await startBroker();
  t.after(() => broker.close());
  const response = await fetch(`${broker.url}/internal/pairing`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  });
  assert.equal(response.status, 201);
  const pairing = await response.json();
  assert.match(pairing.code, /^[A-Za-z0-9_-]{20,}$/);

  const paired = await openSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', {
    type: 'pair',
    code: pairing.code,
  });
  assert.equal(paired.type, 'paired');
  assert.match(paired.deviceKey, /^[A-Za-z0-9_-]{20,}$/);

  const reused = await openSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', {
    type: 'pair',
    code: pairing.code,
  });
  assert.equal(reused.type, 'error');

  const status = await fetch(`${broker.url}/internal/status`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  assert.deepEqual(status.extension, { connected: false, paired: true });
});

test('pins reconnect authentication to the paired extension origin and device key', async (t) => {
  const broker = await startBroker();
  t.after(() => broker.close());
  const pairing = await fetch(`${broker.url}/internal/pairing`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  const paired = await openSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', {
    type: 'pair',
    code: pairing.code,
  });

  const rejected = await openSocket(broker.wsUrl, 'chrome-extension://differentextension', {
    type: 'authenticate',
    deviceKey: paired.deviceKey,
  });
  assert.equal(rejected.type, 'error');

  const authenticated = await openSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', {
    type: 'authenticate',
    deviceKey: paired.deviceKey,
  });
  assert.equal(authenticated.type, 'authenticated');
  assert.equal(authenticated.connectionGeneration, 1);
});

test('lists only opaque tab metadata announced by an authenticated extension', async (t) => {
  const broker = await startBroker();
  t.after(() => broker.close());
  const pairing = await fetch(`${broker.url}/internal/pairing`, {
    method: 'POST', headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  const paired = await openSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', { type: 'pair', code: pairing.code });
  const socket = await authenticateSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', paired.deviceKey);
  t.after(() => socket.close());
  socket.send(JSON.stringify({ type: 'tab_shared', tab: { id: 'tab_opaque', origin: 'https://example.test', title: 'Example' } }));
  await new Promise((resolve) => setImmediate(resolve));
  const tabs = await fetch(`${broker.url}/internal/tools/browser_list_tabs`, {
    method: 'POST', headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' }, body: '{}',
  }).then((res) => res.json());
  assert.deepEqual(tabs, { tabs: [{ id: 'tab_opaque', origin: 'https://example.test', title: 'Example' }] });
});

function openSocket(url, origin, message) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin });
    socket.once('error', reject);
    socket.once('open', () => socket.send(JSON.stringify(message)));
    socket.once('message', (data) => {
      socket.close();
      resolve(JSON.parse(data.toString()));
    });
  });
}

function authenticateSocket(url, origin, deviceKey) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin });
    socket.once('error', reject);
    socket.once('open', () => socket.send(JSON.stringify({ type: 'authenticate', deviceKey })));
    socket.once('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type !== 'authenticated') reject(new Error('authentication failed'));
      else resolve(socket);
    });
  });
}
