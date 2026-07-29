import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackgroundController, isSafeBrokerSocketUrl } from '../extension/background.mjs';

test('only permits loopback WebSocket Broker URLs', () => {
  assert.equal(isSafeBrokerSocketUrl('ws://127.0.0.1:18766/extension'), true);
  assert.equal(isSafeBrokerSocketUrl('wss://localhost:18766/extension'), true);
  assert.equal(isSafeBrokerSocketUrl('ws://broker.example/extension'), false);
  assert.equal(isSafeBrokerSocketUrl('http://127.0.0.1:18766/extension'), false);
});

test('shares only an explicitly selected active HTTPS tab and never exposes its browser tab id', async () => {
  const stored = {};
  const listeners = { removed: null, updated: null };
  const chromeApi = {
    storage: { local: { get: async () => stored, set: async (value) => Object.assign(stored, value), remove: async (key) => delete stored[key] } },
    tabs: {
      query: async () => [{ id: 42, url: 'https://example.test/path', title: 'Example' }],
      onRemoved: { addListener: (listener) => { listeners.removed = listener; } },
      onUpdated: { addListener: (listener) => { listeners.updated = listener; } },
    },
    permissions: { request: async ({ origins }) => origins[0] === 'https://example.test/*' },
  };
  class FakeSocket { static OPEN = 1; }
  const controller = createBackgroundController({ chromeApi, WebSocketImpl: FakeSocket, randomId: () => 'opaque' });
  await controller.load();
  const state = await controller.shareActiveTab();
  assert.deepEqual(state.sharedTabs, [{ id: 'tab_opaque', origin: 'https://example.test', title: 'Example' }]);
  assert.equal(JSON.stringify(state).includes('42'), false);
  assert.equal(stored.browserBridge.sharedTabs.tab_opaque.browserTabId, 42);
  listeners.removed(42);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(controller.publicState().sharedTabs, []);
});
