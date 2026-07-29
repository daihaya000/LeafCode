import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
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

  const pairing = await fetch(`${broker.url}/internal/pairing`, {
    method: 'POST', headers: { Authorization: `Bearer ${broker.internalToken}` },
  }).then((res) => res.json());
  const paired = await openSocket(broker.wsUrl, 'chrome-extension://abcdefghijklmno', {
    type: 'pair', code: pairing.code,
  });
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
});
