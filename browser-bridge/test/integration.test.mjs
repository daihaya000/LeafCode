import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createBrowserBridgeBroker } from '../broker/server.mjs';
import { BrowserBridgeClient } from '../mcp/broker-client.mjs';
import { BrowserToolName } from '../shared/schemas.mjs';

async function startBroker() {
  const broker = createBrowserBridgeBroker({
    internalToken: randomBytes(32).toString('base64url'),
    WebSocketServer: (await import('ws')).WebSocketServer,
  });
  await broker.listen(0);
  return broker;
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
 * the resulting `{type: 'paired', deviceKey}` message.
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
      if (message.type === 'authenticated') resolve(socket);
      else reject(new Error('authentication failed'));
    });
  });
}

test('MCP client reads status and explicitly shared tabs through the live Broker', async (t) => {
  const broker = await startBroker();
  t.after(() => broker.close());
  const client = new BrowserBridgeClient({ baseUrl: broker.url, token: broker.internalToken });
  assert.deepEqual(await client.call(BrowserToolName.STATUS, {}), {
    extension: { connected: false, paired: false }, pendingApprovals: 0,
  });

  const paired = await pairOnly(broker, 'chrome-extension://abcdefghijklmno');
  const socket = await authenticateSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', paired.deviceKey);
  t.after(() => socket.close());
  socket.send(JSON.stringify({
    type: 'tab_shared',
    tab: { id: 'tab_opaque', origin: 'https://example.test', title: 'Example' },
  }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(await client.call(BrowserToolName.STATUS, {}), {
    extension: { connected: true, paired: true }, pendingApprovals: 0,
  });
  assert.deepEqual(await client.call(BrowserToolName.LIST_TABS, {}), {
    tabs: [{ id: 'tab_opaque', origin: 'https://example.test', title: 'Example' }],
  });
  const requested = new Promise((resolve, reject) => socket.once('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type !== 'snapshot_request' || message.tabId !== 'tab_opaque') {
      reject(new Error('expected snapshot request'));
      return;
    }
    socket.send(JSON.stringify({
      type: 'snapshot', tabId: 'tab_opaque',
      snapshot: { snapshotGeneration: 1, truncated: false, nodes: [{ ref: 'ref_1_1', role: 'button', name: 'Save' }] },
    }));
    resolve();
  }));
  const snapshotRequest = client.call(BrowserToolName.SNAPSHOT, { tabId: 'tab_opaque' });
  await requested;
  assert.deepEqual(await snapshotRequest, {
    snapshotGeneration: 1, truncated: false, nodes: [{ ref: 'ref_1_1', role: 'button', name: 'Save' }],
  });
  await assert.rejects(
    () => client.call(BrowserToolName.CLICK, { tabId: 'tab_opaque', ref: 'ref_1_1', snapshotGeneration: 1 }),
    (error) => error.code === 'APPROVAL_REQUIRED',
  );
  const approvals = await fetch(`${broker.url}/internal/approvals`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  const approvalId = approvals.approvals[0].approvalId;
  const commandReceived = new Promise((resolve, reject) => socket.once('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type !== 'command' || message.commandId !== approvalId) {
      reject(new Error('expected approved command'));
      return;
    }
    resolve(message);
  }));
  await fetch(`${broker.url}/internal/approvals/${approvalId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${broker.internalToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'allow' }),
  });
  const command = await commandReceived;
  assert.deepEqual(command.args, { tabId: 'tab_opaque', ref: 'ref_1_1', snapshotGeneration: 1 });
  socket.send(JSON.stringify({
    protocolVersion: 1, type: 'result', commandId: approvalId,
    connectionGeneration: command.connectionGeneration, state: 'succeeded', result: {},
  }));
  await new Promise((resolve) => setImmediate(resolve));
  const audit = await fetch(`${broker.url}/internal/audit`, {
    headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  assert.deepEqual(audit.entries.map(({ commandId, tool, outcome, approval }) => ({ commandId, tool, outcome, approval })), [
    { commandId: approvalId, tool: 'browser_click', outcome: 'succeeded', approval: 'single' },
  ]);
});
