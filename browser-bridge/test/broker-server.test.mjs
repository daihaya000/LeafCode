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

  const click = await fetch(`${broker.url}/internal/tools/browser_click`, {
    method: 'POST', headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ tabId: 'tab_opaque', ref: 'ref_1_1', snapshotGeneration: 1 }),
  });
  assert.equal(click.status, 428);
  const clickBody = await click.json();
  assert.equal(clickBody.error.code, 'APPROVAL_REQUIRED');
  assert.match(clickBody.error.approvalId, /^approval_[A-Za-z0-9_-]+$/);
  const approvals = await fetch(`${broker.url}/internal/approvals`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  assert.deepEqual(approvals.approvals.map(({ approvalId, tool, tabId, origin }) => ({ approvalId, tool, tabId, origin })), [{
    approvalId: clickBody.error.approvalId, tool: 'browser_click', tabId: 'tab_opaque', origin: 'https://example.test',
  }]);
  const decision = await fetch(`${broker.url}/internal/approvals/${clickBody.error.approvalId}`, {
    method: 'POST', headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'deny' }),
  });
  assert.deepEqual(await decision.json(), { approvalId: clickBody.error.approvalId, decision: 'deny' });
  const approvalStatus = await fetch(`${broker.url}/internal/status`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  assert.equal(approvalStatus.pendingApprovals, 0);

  const secondClick = await fetch(`${broker.url}/internal/tools/browser_click`, {
    method: 'POST', headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ tabId: 'tab_opaque', ref: 'ref_1_1', snapshotGeneration: 1 }),
  }).then((res) => res.json());
  const commandReceived = new Promise((resolve, reject) => socket.once('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type !== 'command') return reject(new Error('expected command'));
    resolve(message);
  }));
  await fetch(`${broker.url}/internal/approvals/${secondClick.error.approvalId}`, {
    method: 'POST', headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'allow' }),
  });
  const command = await commandReceived;
  assert.deepEqual(command, { protocolVersion: 1, type: 'command', commandId: secondClick.error.approvalId, connectionGeneration: 1, tool: 'browser_click', args: { tabId: 'tab_opaque', ref: 'ref_1_1', snapshotGeneration: 1 } });
  socket.send(JSON.stringify({ protocolVersion: 1, type: 'result', commandId: command.commandId, connectionGeneration: 1, state: 'succeeded', result: {} }));
  await new Promise((resolve) => setImmediate(resolve));
  const audit = await fetch(`${broker.url}/internal/audit`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  assert.deepEqual(audit.entries.map(({ commandId, tool, origin, outcome, approval }) => ({ commandId, tool, origin, outcome, approval })), [{
    commandId: secondClick.error.approvalId, tool: 'browser_click', origin: 'https://example.test', outcome: 'succeeded', approval: 'single',
  }]);

  socket.send(JSON.stringify({ type: 'snapshot', tabId: 'tab_opaque', snapshot: { snapshotGeneration: 1, truncated: false, nodes: [{ ref: 'ref_1_1', role: 'button', name: 'Save' }] } }));
  await new Promise((resolve) => setImmediate(resolve));
  const refreshRequested = new Promise((resolve, reject) => socket.once('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type !== 'snapshot_request') return reject(new Error('expected snapshot request'));
    socket.send(JSON.stringify({ type: 'snapshot', tabId: message.tabId, snapshot: { snapshotGeneration: 2, truncated: false, nodes: [{ ref: 'ref_2_1', role: 'button', name: 'Save now' }] } }));
    resolve();
  }));
  const snapshotResponse = fetch(`${broker.url}/internal/tools/browser_snapshot`, {
    method: 'POST', headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ tabId: 'tab_opaque' }),
  });
  await refreshRequested;
  const snapshot = await snapshotResponse.then((res) => res.json());
  assert.deepEqual(snapshot, { snapshotGeneration: 2, truncated: false, nodes: [{ ref: 'ref_2_1', role: 'button', name: 'Save now' }] });

  const requestedScreenshot = await fetch(`${broker.url}/internal/tools/browser_screenshot`, {
    method: 'POST', headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ tabId: 'tab_opaque' }),
  }).then((res) => res.json());
  const screenshotCommand = new Promise((resolve, reject) => socket.once('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type !== 'command' || message.tool !== 'browser_screenshot') return reject(new Error('expected screenshot command'));
    resolve(message);
  }));
  await fetch(`${broker.url}/internal/approvals/${requestedScreenshot.error.approvalId}`, {
    method: 'POST', headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'allow' }),
  });
  const capture = await screenshotCommand;
  socket.send(JSON.stringify({ protocolVersion: 1, type: 'result', commandId: capture.commandId, connectionGeneration: 1, state: 'succeeded', result: { image: { mimeType: 'image/png', data: 'aGVsbG8=' } } }));
  await new Promise((resolve) => setImmediate(resolve));
  const delivered = await fetch(`${broker.url}/internal/tools/browser_screenshot`, {
    method: 'POST', headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ tabId: 'tab_opaque' }),
  }).then((res) => res.json());
  assert.deepEqual(delivered, { image: { mimeType: 'image/png', data: 'aGVsbG8=' } });
  const consumed = await fetch(`${broker.url}/internal/tools/browser_screenshot`, {
    method: 'POST', headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ tabId: 'tab_opaque' }),
  });
  assert.equal(consumed.status, 428);
  const socketClosed = new Promise((resolve) => socket.once('close', resolve));
  socket.close();
  await socketClosed;
  await new Promise((resolve) => setTimeout(resolve, 25));
  const disconnectedStatus = await fetch(`${broker.url}/internal/status`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  assert.deepEqual(disconnectedStatus, { extension: { connected: false, paired: true }, pendingApprovals: 0 });
});

test('rejects a command result from a stale connection generation', async (t) => {
  const broker = await startBroker();
  t.after(() => broker.close());
  const headers = { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' };
  const pairing = await fetch(`${broker.url}/internal/pairing`, { method: 'POST', headers: { Authorization: `Bearer ${broker.internalToken}` } }).then((res) => res.json());
  const paired = await openSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', { type: 'pair', code: pairing.code });
  const socket = await authenticateSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', paired.deviceKey);
  socket.send(JSON.stringify({ type: 'tab_shared', tab: { id: 'tab_opaque', origin: 'https://example.test', title: 'Example' } }));
  await new Promise((resolve) => setImmediate(resolve));

  const requested = await fetch(`${broker.url}/internal/tools/browser_screenshot`, {
    method: 'POST', headers, body: JSON.stringify({ tabId: 'tab_opaque' }),
  }).then((res) => res.json());
  const commandReceived = new Promise((resolve, reject) => socket.once('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type !== 'command') return reject(new Error('expected command'));
    resolve(message);
  }));
  await fetch(`${broker.url}/internal/approvals/${requested.error.approvalId}`, {
    method: 'POST', headers, body: JSON.stringify({ decision: 'allow' }),
  });
  const command = await commandReceived;
  const closed = new Promise((resolve) => socket.once('close', resolve));
  socket.send(JSON.stringify({
    protocolVersion: 1, type: 'result', commandId: command.commandId,
    connectionGeneration: command.connectionGeneration + 1, state: 'succeeded', result: {},
  }));
  await closed;
  await new Promise((resolve) => setTimeout(resolve, 25));
  const audit = await fetch(`${broker.url}/internal/audit`, { headers: { Authorization: `Bearer ${broker.internalToken}` } }).then((res) => res.json());
  assert.deepEqual(audit.entries, []);
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
