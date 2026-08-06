import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createBrowserBridgeBroker } from '../broker/server.mjs';
import { MAX_MESSAGE_BYTES } from '../shared/schemas.mjs';

async function startBroker(options = {}) {
  const broker = createBrowserBridgeBroker({
    internalToken: randomBytes(32).toString('base64url'),
    WebSocketServer: (await import('ws')).WebSocketServer,
    pairingTtlMs: 500,
    ...options,
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

test('reports a connected-but-unsupported tool as an invalid request, not a disconnect', async (t) => {
  const broker = await startBroker();
  t.after(() => broker.close());
  const headers = { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' };

  const paired = await pairOnly(broker, 'chrome-extension://abcdefghijklmno');
  const socket = await authenticateSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', paired.deviceKey);
  t.after(() => socket.close());

  const response = await fetch(`${broker.url}/internal/tools/browser_wait`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tabId: 'tab_opaque', timeoutMs: 1000 }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: { code: 'INVALID_REQUEST' } });

  const status = await fetch(`${broker.url}/internal/status`, { headers }).then((res) => res.json());
  assert.equal(status.extension.connected, true);
});

test('rejects oversized internal tool payloads before parsing them', async (t) => {
  const broker = await startBroker();
  t.after(() => broker.close());
  const response = await fetch(`${broker.url}/internal/tools/browser_status`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(MAX_MESSAGE_BYTES) }),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: { code: 'PAYLOAD_TOO_LARGE' } });
});

test('rejects oversized approval decisions without leaving an unhandled request error', async (t) => {
  const broker = await startBroker();
  t.after(() => broker.close());
  const response = await fetch(`${broker.url}/internal/approvals/approval_missing`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(MAX_MESSAGE_BYTES) }),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: { code: 'PAYLOAD_TOO_LARGE' } });
});

test('offers no code: an unpaired extension requests pairing and only the WebUI-approved decision grants a device key', async (t) => {
  const broker = await startBroker();
  t.after(() => broker.close());
  const origin = 'chrome-extension://abcdefghijklmno';
  const socket = await connectSocket(broker.wsUrl, origin);
  const requested = await nextMessage(socket, () => socket.send(JSON.stringify({ type: 'request_pairing' })));
  assert.equal(requested.type, 'pairing_requested');
  assert.match(requested.requestId, /^pairing_request_[A-Za-z0-9_-]+$/);

  const list = await fetch(`${broker.url}/internal/pairing-requests`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  assert.deepEqual(list.requests.map(({ requestId, origin: requestOrigin }) => ({ requestId, origin: requestOrigin })), [
    { requestId: requested.requestId, origin },
  ]);

  let decision;
  const paired = await nextMessage(socket, () => {
    decision = fetch(`${broker.url}/internal/pairing-requests/${requested.requestId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'allow' }),
    });
  });
  decision = await decision;
  assert.equal(decision.status, 200);
  assert.deepEqual(await decision.json(), { requestId: requested.requestId, decision: 'allow' });
  assert.equal(paired.type, 'paired');
  assert.match(paired.deviceKey, /^[A-Za-z0-9_-]{20,}$/);

  // The decision consumes the request; re-deciding the same id is a 404, and
  // it no longer appears in the pending list.
  const reused = await fetch(`${broker.url}/internal/pairing-requests/${requested.requestId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'allow' }),
  });
  assert.equal(reused.status, 404);

  const status = await fetch(`${broker.url}/internal/status`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  assert.deepEqual(status.extension, { connected: false, paired: true });
  socket.close();
});

test('grants pairing state even if the extension socket is already closing when "allow" is decided', async (t) => {
  // Regression test: the WebUI showed the pairing request as allowed, but a
  // service-worker restart racing with the click meant the extension's
  // socket was mid-close by the time the decision reached the Broker. The
  // old code only recorded the pairing when `socket.readyState === OPEN`,
  // silently no-opping otherwise while still returning HTTP 200 - so the
  // extension stayed unpaired and immediately re-announced itself with a
  // fresh pairing card that looked like the same request looping forever.
  const broker = await startBroker();
  t.after(() => broker.close());
  const origin = 'chrome-extension://abcdefghijklmno';
  const socket = await connectSocket(broker.wsUrl, origin);
  const requested = await nextMessage(socket, () => socket.send(JSON.stringify({ type: 'request_pairing' })));
  assert.equal(requested.type, 'pairing_requested');

  // Start closing the socket, then immediately (before the close handshake
  // completes) send the allow decision, matching the observed race.
  socket.close();
  const decision = await fetch(`${broker.url}/internal/pairing-requests/${requested.requestId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'allow' }),
  });
  assert.equal(decision.status, 200);
  assert.deepEqual(await decision.json(), { requestId: requested.requestId, decision: 'allow' });

  // A fresh reconnect from the same origin must be recognized as already
  // paired, not asked to re-request pairing, exactly like the real
  // extension's `paired` handler which authenticates on the same reply.
  const reconnect = await connectSocket(broker.wsUrl, origin);
  t.after(() => reconnect.close());
  const reissued = await nextMessage(reconnect, () => reconnect.send(JSON.stringify({ type: 'request_pairing' })));
  assert.equal(reissued.type, 'paired');
  const authenticated = await nextMessage(reconnect, () => reconnect.send(JSON.stringify({ type: 'authenticate', deviceKey: reissued.deviceKey })));
  assert.equal(authenticated.type, 'authenticated');

  const status = await fetch(`${broker.url}/internal/status`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  assert.deepEqual(status.extension, { connected: true, paired: true });
});

test('denying a pairing request tells the extension without granting a device key', async (t) => {
  const broker = await startBroker();
  t.after(() => broker.close());
  const origin = 'chrome-extension://abcdefghijklmno';
  const socket = await connectSocket(broker.wsUrl, origin);
  const requested = await nextMessage(socket, () => socket.send(JSON.stringify({ type: 'request_pairing' })));

  const closed = new Promise((resolve) => socket.once('close', resolve));
  const denied = await nextMessage(socket, () => fetch(`${broker.url}/internal/pairing-requests/${requested.requestId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'deny' }),
  }));
  assert.deepEqual(denied, { type: 'pairing_denied' });
  await closed;

  const status = await fetch(`${broker.url}/internal/status`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  assert.deepEqual(status.extension, { connected: false, paired: false });
});

test('expires an undecided pairing request and drops it from the pending list when the extension disconnects first', async (t) => {
  const broker = await startBroker({ pairingTtlMs: 20 });
  t.after(() => broker.close());
  const origin = 'chrome-extension://abcdefghijklmno';
  const expiring = await connectSocket(broker.wsUrl, origin);
  const closedByExpiry = new Promise((resolve) => expiring.once('close', resolve));
  await nextMessage(expiring, () => expiring.send(JSON.stringify({ type: 'request_pairing' })));
  await closedByExpiry;
  const afterExpiry = await fetch(`${broker.url}/internal/pairing-requests`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  assert.deepEqual(afterExpiry.requests, []);

  const disconnecting = await connectSocket(broker.wsUrl, origin);
  await nextMessage(disconnecting, () => disconnecting.send(JSON.stringify({ type: 'request_pairing' })));
  disconnecting.close();
  await new Promise((resolve) => setTimeout(resolve, 25));
  const afterDisconnect = await fetch(`${broker.url}/internal/pairing-requests`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  assert.deepEqual(afterDisconnect.requests, []);
});

test('an already-paired extension origin does not create a new pending pairing request', async (t) => {
  const broker = await startBroker();
  t.after(() => broker.close());
  const origin = 'chrome-extension://abcdefghijklmno';
  const paired = await pairOnly(broker, origin);
  assert.equal(paired.type, 'paired');
  assert.match(paired.deviceKey, /^[A-Za-z0-9_-]{20,}$/);

  // A fresh unauthenticated socket from the same extension origin should not
  // surface another approval card in the WebUI; it is told to use the existing
  // pairing immediately.
  const reconnect = await connectSocket(broker.wsUrl, origin);
  t.after(() => reconnect.close());
  const reissued = await nextMessage(reconnect, () => reconnect.send(JSON.stringify({ type: 'request_pairing' })));
  assert.deepEqual(reissued, { type: 'paired', deviceKey: paired.deviceKey });

  const list = await fetch(`${broker.url}/internal/pairing-requests`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  assert.deepEqual(list.requests, []);
});

test('pins reconnect authentication to the paired extension origin and device key', async (t) => {
  const broker = await startBroker();
  t.after(() => broker.close());
  const paired = await pairOnly(broker, 'chrome-extension://abcdefghijklmno');

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

test('restores a local pairing across Broker restart and clears it on extension revoke', async (t) => {
  const persistedPairing = { origin: 'chrome-extension://abcdefghijklmnop', deviceKey: 'device_key_abcdefghijklmnopqrstuvwxyz' };
  const changes = [];
  const broker = await startBroker({ persistedPairing, onPairingChanged: (value) => changes.push(value) });
  t.after(() => broker.close());
  const socket = await authenticateSocket(broker.wsUrl, persistedPairing.origin, persistedPairing.deviceKey);
  const closed = new Promise((resolve) => socket.once('close', resolve));
  socket.send(JSON.stringify({ type: 'unpair' }));
  await closed;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(changes, [null]);
  const status = await fetch(`${broker.url}/internal/status`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  assert.deepEqual(status.extension, { connected: false, paired: false });
});

test('closes an authenticated extension that exceeds the WebSocket message limit', async (t) => {
  const broker = await startBroker();
  t.after(() => broker.close());
  const paired = await pairOnly(broker, 'chrome-extension://abcdefghijklmno');
  const socket = await authenticateSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', paired.deviceKey);
  const closed = new Promise((resolve) => socket.once('close', (code) => resolve(code)));
  socket.send('x'.repeat(MAX_MESSAGE_BYTES + 1));
  assert.equal(await closed, 1009);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const status = await fetch(`${broker.url}/internal/status`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  assert.deepEqual(status, { extension: { connected: false, paired: true }, pendingApprovals: 0 });
});

test('returns COMMAND_TIMEOUT when an extension does not answer a snapshot request', async (t) => {
  const broker = await startBroker({ snapshotRequestTimeoutMs: 20 });
  t.after(() => broker.close());
  const paired = await pairOnly(broker, 'chrome-extension://abcdefghijklmno');
  const socket = await authenticateSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', paired.deviceKey);
  t.after(() => socket.close());
  socket.send(JSON.stringify({ type: 'tab_shared', tab: { id: 'tab_opaque', origin: 'https://example.test', title: 'Example' } }));
  await new Promise((resolve) => setImmediate(resolve));
  const response = await fetch(`${broker.url}/internal/tools/browser_snapshot`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tabId: 'tab_opaque' }),
  });
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { error: { code: 'COMMAND_TIMEOUT' } });
});

test('settles a pending snapshot as COMMAND_TIMEOUT when the extension disconnects', async (t) => {
  const broker = await startBroker({ snapshotRequestTimeoutMs: 5_000 });
  t.after(() => broker.close());
  const headers = { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' };
  const paired = await pairOnly(broker, 'chrome-extension://abcdefghijklmno');
  const socket = await authenticateSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', paired.deviceKey);
  socket.send(JSON.stringify({ type: 'tab_shared', tab: { id: 'tab_opaque', origin: 'https://example.test', title: 'Example' } }));
  await new Promise((resolve) => setImmediate(resolve));
  const requested = new Promise((resolve, reject) => socket.once('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type !== 'snapshot_request') return reject(new Error('expected snapshot request'));
    resolve();
  }));
  const response = fetch(`${broker.url}/internal/tools/browser_snapshot`, {
    method: 'POST', headers, body: JSON.stringify({ tabId: 'tab_opaque' }),
  });
  await requested;
  const closed = new Promise((resolve) => socket.once('close', resolve));
  socket.close();
  await closed;
  const settled = await response;
  assert.equal(settled.status, 504);
  assert.deepEqual(await settled.json(), { error: { code: 'COMMAND_TIMEOUT' } });
  const status = await fetch(`${broker.url}/internal/status`, { headers }).then((res) => res.json());
  assert.deepEqual(status, { extension: { connected: false, paired: true }, pendingApprovals: 0 });
});

test('lists only opaque tab metadata announced by an authenticated extension', async (t) => {
  const broker = await startBroker();
  t.after(() => broker.close());
  const paired = await pairOnly(broker, 'chrome-extension://abcdefghijklmno');
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
  const paired = await pairOnly(broker, 'chrome-extension://abcdefghijklmno');
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

test('drops a late result after the dispatched command expires', async (t) => {
  const broker = await startBroker({ commandTimeoutMs: 20 });
  t.after(() => broker.close());
  const headers = { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' };
  const paired = await pairOnly(broker, 'chrome-extension://abcdefghijklmno');
  const socket = await authenticateSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', paired.deviceKey);
  t.after(() => socket.close());
  socket.send(JSON.stringify({ type: 'tab_shared', tab: { id: 'tab_opaque', origin: 'https://example.test', title: 'Example' } }));
  await new Promise((resolve) => setImmediate(resolve));
  const requested = await fetch(`${broker.url}/internal/tools/browser_screenshot`, {
    method: 'POST', headers, body: JSON.stringify({ tabId: 'tab_opaque' }),
  }).then((res) => res.json());
  const commandReceived = new Promise((resolve) => socket.once('message', (data) => resolve(JSON.parse(data.toString()))));
  await fetch(`${broker.url}/internal/approvals/${requested.error.approvalId}`, { method: 'POST', headers, body: JSON.stringify({ decision: 'allow' }) });
  const command = await commandReceived;
  await new Promise((resolve) => setTimeout(resolve, 30));
  socket.send(JSON.stringify({ protocolVersion: 1, type: 'result', commandId: command.commandId, connectionGeneration: command.connectionGeneration, state: 'succeeded', result: { image: { mimeType: 'image/png', data: 'aGVsbG8=' } } }));
  await new Promise((resolve) => setImmediate(resolve));
  const nextScreenshot = await fetch(`${broker.url}/internal/tools/browser_screenshot`, {
    method: 'POST', headers, body: JSON.stringify({ tabId: 'tab_opaque' }),
  });
  assert.equal(nextScreenshot.status, 428);
  const audit = await fetch(`${broker.url}/internal/audit`, { headers: { Authorization: `Bearer ${broker.internalToken}` } }).then((res) => res.json());
  assert.deepEqual(audit.entries, []);
});

test('expires an unapproved action without dispatching it later', async (t) => {
  const broker = await startBroker({ approvalTimeoutMs: 20 });
  t.after(() => broker.close());
  const headers = { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' };
  const paired = await pairOnly(broker, 'chrome-extension://abcdefghijklmno');
  const socket = await authenticateSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', paired.deviceKey);
  t.after(() => socket.close());
  socket.send(JSON.stringify({ type: 'tab_shared', tab: { id: 'tab_opaque', origin: 'https://example.test', title: 'Example' } }));
  await new Promise((resolve) => setImmediate(resolve));
  const requested = await fetch(`${broker.url}/internal/tools/browser_screenshot`, {
    method: 'POST', headers, body: JSON.stringify({ tabId: 'tab_opaque' }),
  }).then((res) => res.json());
  await new Promise((resolve) => setTimeout(resolve, 30));
  const approvals = await fetch(`${broker.url}/internal/approvals`, { headers: { Authorization: `Bearer ${broker.internalToken}` } }).then((res) => res.json());
  assert.deepEqual(approvals, { approvals: [] });
  const expired = await fetch(`${broker.url}/internal/approvals/${requested.error.approvalId}`, {
    method: 'POST', headers, body: JSON.stringify({ decision: 'allow' }),
  });
  assert.equal(expired.status, 404);
  const command = await Promise.race([
    new Promise((resolve) => socket.once('message', resolve)),
    new Promise((resolve) => setTimeout(() => resolve(null), 20)),
  ]);
  assert.equal(command, null);
});

test('close() completes while an unauthenticated extension socket is still connected', async (t) => {
  const broker = await startBroker();
  const socket = await connectSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno');
  t.after(() => socket.close());
  await nextMessage(socket, () => socket.send(JSON.stringify({ type: 'request_pairing' })));

  // An upgraded socket the Broker never authenticated is still a live HTTP
  // connection; if close() ignored it, server.close() would never call back.
  const closed = await Promise.race([
    broker.close().then(() => 'closed'),
    new Promise((resolve) => setTimeout(() => resolve('hung'), 2_000)),
  ]);
  assert.equal(closed, 'closed');
  assert.equal(socket.readyState > 1, true);
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

function connectSocket(url, origin) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin });
    socket.once('error', reject);
    socket.once('open', () => resolve(socket));
  });
}

function nextMessage(socket, beforeWaiting) {
  const promise = new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
  if (beforeWaiting) beforeWaiting();
  return promise;
}

/**
 * Requests pairing on a fresh socket, immediately allows it through the
 * internal API (as the WebUI's one-click "許可" would), and resolves with
 * the resulting `{type: 'paired', deviceKey}` message. The socket is closed
 * afterwards so callers can open a normal `authenticate`-only reconnect via
 * `authenticateSocket`, matching how a real extension re-connects later.
 */
async function pairOnly(broker, origin) {
  const socket = await connectSocket(broker.wsUrl, origin);
  const requested = await nextMessage(socket, () => socket.send(JSON.stringify({ type: 'request_pairing' })));
  if (requested.type !== 'pairing_requested') throw new Error('expected pairing_requested');
  const paired = await nextMessage(socket, () => {
    void fetch(`${broker.url}/internal/pairing-requests/${requested.requestId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'allow' }),
    });
  });
  socket.close();
  return paired;
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

test('lists shared tabs and clears them on revoke', async (t) => {
  const broker = await startBroker();
  t.after(() => broker.close());
  const headers = { Authorization: `Bearer ${broker.internalToken}` };

  const empty = await fetch(`${broker.url}/internal/tabs`, { headers }).then((res) => res.json());
  assert.deepEqual(empty, { tabs: [] });

  const paired = await pairOnly(broker, 'chrome-extension://abcdefghijklmno');
  const socket = await authenticateSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', paired.deviceKey);
  t.after(() => socket.close());
  socket.send(JSON.stringify({ type: 'tab_shared', tab: { id: 'tab_opaque', origin: 'https://example.test', title: 'Example' } }));
  await new Promise((resolve) => setImmediate(resolve));

  const tabs = await fetch(`${broker.url}/internal/tabs`, { headers }).then((res) => res.json());
  assert.deepEqual(tabs, { tabs: [{ id: 'tab_opaque', origin: 'https://example.test', title: 'Example' }] });

  // The close may fire before the revoke response resolves, so register the
  // close listener up-front and race it against a short timeout.
  const closed = new Promise((resolve) => {
    socket.once('close', () => resolve(true));
    setTimeout(() => resolve(false), 2000);
  });
  const revoked = await fetch(`${broker.url}/internal/revoke`, {
    method: 'POST',
    headers,
  }).then((res) => res.json());
  assert.deepEqual(revoked, { revoked: true });
  assert.equal(await closed, true);

  const after = await fetch(`${broker.url}/internal/tabs`, { headers }).then((res) => res.json());
  assert.deepEqual(after, { tabs: [] });
  const status = await fetch(`${broker.url}/internal/status`, { headers }).then((res) => res.json());
  assert.deepEqual(status.extension, { connected: false, paired: false });

  const audit = await fetch(`${broker.url}/internal/audit`, { headers }).then((res) => res.json());
  assert.equal(audit.entries.some((entry) => entry.tool === 'revoke' && entry.outcome === 'revoked'), true);
});
