import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackgroundController, isSafeBrokerSocketUrl } from '../extension/background.mjs';

function createAutoShareChromeApi({ containsResult = true } = {}) {
  const stored = {};
  const listeners = { removed: null, updated: null, activated: null };
  const requests = [];
  const tabsById = {
    42: { id: 42, url: 'https://example.test/path', title: 'Example', active: true, status: 'complete' },
    43: { id: 43, url: 'https://second.test/path', title: 'Second', active: true, status: 'complete' },
  };
  const chromeApi = {
    storage: { local: { get: async () => stored, set: async (value) => Object.assign(stored, value), remove: async (key) => delete stored[key] } },
    tabs: {
      query: async () => [tabsById[42]],
      get: async (id) => tabsById[id],
      onRemoved: { addListener: (listener) => { listeners.removed = listener; } },
      onUpdated: { addListener: (listener) => { listeners.updated = listener; } },
      onActivated: { addListener: (listener) => { listeners.activated = listener; } },
    },
    permissions: {
      request: async ({ origins }) => { requests.push(origins); return true; },
      contains: async () => containsResult,
    },
    scripting: { executeScript: async () => {} },
  };
  return { chromeApi, listeners, requests, tabsById };
}

test('only permits loopback WebSocket Broker URLs', () => {
  assert.equal(isSafeBrokerSocketUrl('ws://127.0.0.1:18766/extension'), true);
  assert.equal(isSafeBrokerSocketUrl('wss://localhost:18766/extension'), true);
  assert.equal(isSafeBrokerSocketUrl('ws://broker.example/extension'), false);
  assert.equal(isSafeBrokerSocketUrl('http://127.0.0.1:18766/extension'), false);
});

test('shares only an explicitly selected active HTTPS tab and never exposes its browser tab id', async () => {
  const stored = {};
  const listeners = { removed: null, updated: null };
  const injected = [];
  const chromeApi = {
    storage: { local: { get: async () => stored, set: async (value) => Object.assign(stored, value), remove: async (key) => delete stored[key] } },
    tabs: {
      query: async () => [{ id: 42, url: 'https://example.test/path', title: 'Example' }],
      get: async (id) => ({ id, active: true, windowId: 7 }),
      captureVisibleTab: async (windowId, options) => {
        assert.equal(windowId, 7);
        assert.deepEqual(options, { format: 'png' });
        return 'data:image/png;base64,aGVsbG8=';
      },
      sendMessage: async (tabId, message) => ({ snapshotGeneration: message.snapshotGeneration, nodes: [{ ref: `ref_${message.snapshotGeneration}_1`, role: 'button', name: 'Save' }], truncated: false }),
      onRemoved: { addListener: (listener) => { listeners.removed = listener; } },
      onUpdated: { addListener: (listener) => { listeners.updated = listener; } },
    },
    permissions: { request: async ({ origins }) => origins[0] === 'https://example.test/*' },
    scripting: { executeScript: async (options) => injected.push(options) },
  };
  class FakeSocket { static OPEN = 1; addEventListener() {} close() {} send() {} }
  const controller = createBackgroundController({ chromeApi, WebSocketImpl: FakeSocket, randomId: () => 'opaque' });
  await controller.load();
  const state = await controller.shareActiveTab();
  assert.deepEqual(state.sharedTabs, [{ id: 'tab_opaque', origin: 'https://example.test', title: 'Example' }]);
  assert.equal(JSON.stringify(state).includes('42'), false);
  assert.equal(stored.browserBridge.sharedTabs.tab_opaque.browserTabId, 42);
  const snapshot = await controller.collectSnapshot('tab_opaque');
  assert.equal(snapshot.snapshotGeneration, 1);
  assert.deepEqual(injected, [{ target: { tabId: 42 }, files: ['extension/content-runtime.js'] }]);
  assert.deepEqual(await controller.captureScreenshot('tab_opaque'), { mimeType: 'image/png', data: 'aGVsbG8=' });
  listeners.removed(42);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(controller.publicState().sharedTabs, []);
});

test('resyncs shared tabs and resets command dedupe on a new connection generation', async () => {
  const stored = { browserBridge: { brokerUrl: 'ws://127.0.0.1:18766/extension', deviceKey: 'device_key', sharedTabs: { tab_opaque: { id: 'tab_opaque', origin: 'https://example.test', title: 'Example', browserTabId: 42 } } } };
  let delivered = 0;
  const chromeApi = {
    storage: { local: { get: async () => stored, set: async () => {}, remove: async () => {} } },
    tabs: {
      sendMessage: async () => { delivered += 1; return { ok: true }; },
      get: async (id) => ({ id, active: true }),
      onRemoved: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
    },
    permissions: { request: async () => true },
    scripting: { executeScript: async () => {} },
  };
  class FakeSocket {
    static OPEN = 1;
    static instances = [];
    constructor() { this.readyState = FakeSocket.OPEN; this.listeners = {}; this.sent = []; FakeSocket.instances.push(this); }
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() {}
    emit(type, event = {}) { for (const listener of this.listeners[type] ?? []) listener(event); }
  }
  const controller = createBackgroundController({ chromeApi, WebSocketImpl: FakeSocket });
  await controller.load();
  const socket = FakeSocket.instances[0];
  socket.emit('open');
  socket.emit('message', { data: JSON.stringify({ type: 'authenticated', connectionGeneration: 1 }) });
  const command = { type: 'command', commandId: 'command_once', connectionGeneration: 1, tool: 'browser_click', args: { tabId: 'tab_opaque', ref: 'ref_1_1', snapshotGeneration: 1 } };
  socket.emit('message', { data: JSON.stringify(command) });
  socket.emit('message', { data: JSON.stringify(command) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delivered, 1);
  assert.equal(socket.sent.filter((message) => message.type === 'result').length, 1);

  socket.emit('message', { data: JSON.stringify({ type: 'authenticated', connectionGeneration: 2 }) });
  socket.emit('message', { data: JSON.stringify({ ...command, connectionGeneration: 2 }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delivered, 2);
  assert.equal(socket.sent.filter((message) => message.type === 'result').length, 2);
  assert.equal(socket.sent.filter((message) => message.type === 'tab_shared').length, 2);
});

test('prunes stale persisted shared tabs on authenticate before re-announcing', async () => {
  const stored = {
    browserBridge: {
      brokerUrl: 'ws://127.0.0.1:18766/extension',
      deviceKey: 'device_key',
      sharedTabs: {
        tab_alive: { id: 'tab_alive', origin: 'https://alive.test', title: 'Alive', browserTabId: 42 },
        tab_dead: { id: 'tab_dead', origin: 'https://dead.test', title: 'Dead', browserTabId: 99 },
      },
    },
  };
  let persisted = JSON.parse(JSON.stringify(stored.browserBridge));
  const chromeApi = {
    storage: { local: { get: async () => stored, set: async (value) => Object.assign(stored, value), remove: async () => {} } },
    tabs: {
      get: async (id) => {
        if (id === 42) return { id: 42, active: true };
        throw new Error('No tab with id: ' + id);
      },
      onRemoved: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
    },
  };
  void persisted;
  class FakeSocket {
    static OPEN = 1;
    static instances = [];
    constructor() { this.readyState = FakeSocket.OPEN; this.listeners = {}; this.sent = []; FakeSocket.instances.push(this); }
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() {}
    emit(type, event = {}) { for (const listener of this.listeners[type] ?? []) listener(event); }
  }
  const controller = createBackgroundController({ chromeApi, WebSocketImpl: FakeSocket });
  await controller.load();
  const socket = FakeSocket.instances[0];
  socket.emit('open');
  socket.emit('message', { data: JSON.stringify({ type: 'authenticated', connectionGeneration: 1 }) });
  await new Promise((resolve) => setImmediate(resolve));

  // The dead tab (browserTabId 99) should be unshared before the alive one is re-announced.
  assert.ok(socket.sent.some((message) => message.type === 'tab_unshared' && message.tabId === 'tab_dead'));
  assert.deepEqual(
    socket.sent.filter((message) => message.type === 'tab_shared').map((message) => message.tab.id),
    ['tab_alive'],
  );
  const state = controller.publicState();
  assert.deepEqual(state.sharedTabs, [{ id: 'tab_alive', origin: 'https://alive.test', title: 'Alive' }]);
  assert.equal(stored.browserBridge.sharedTabs.tab_dead, undefined);
  assert.ok(stored.browserBridge.sharedTabs.tab_alive);
});

test('forgets a stale pairing when the Broker rejects it as NOT_PAIRED instead of looping "reconnecting" forever', async () => {
  const stored = { browserBridge: { brokerUrl: 'ws://127.0.0.1:18766/extension', deviceKey: 'stale_device_key', sharedTabs: {} } };
  class FakeSocket {
    static OPEN = 1;
    static instances = [];
    constructor() { this.readyState = FakeSocket.OPEN; this.listeners = {}; this.sent = []; FakeSocket.instances.push(this); }
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() {}
    emit(type, event = {}) { for (const listener of this.listeners[type] ?? []) listener(event); }
  }
  const chromeApi = {
    storage: { local: { get: async () => stored, set: async (value) => Object.assign(stored, value), remove: async (key) => delete stored[key] } },
    tabs: { onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {} } },
  };
  const controller = createBackgroundController({ chromeApi, WebSocketImpl: FakeSocket });
  await controller.load();
  const socket = FakeSocket.instances[0];
  socket.emit('open');
  socket.emit('message', { data: JSON.stringify({ type: 'error', error: 'NOT_PAIRED' }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.publicState().paired, false);
  assert.equal(stored.browserBridge.deviceKey, null);
  // Rather than looping "reconnecting" forever with a stale key, forgetPairing()
  // immediately offers a fresh pairing request on a brand-new socket so
  // re-approving from the WebUI is the only step needed to recover.
  assert.equal(FakeSocket.instances.length, 2);
  const freshSocket = FakeSocket.instances[1];
  freshSocket.emit('open');
  assert.deepEqual(freshSocket.sent, [{ type: 'request_pairing' }]);
  assert.equal(controller.publicState().pairingRequested, true);
});

test('does not auto-share tabs until the user explicitly enables auto-share', async () => {
  const { chromeApi, listeners, tabsById } = createAutoShareChromeApi();
  class FakeSocket { static OPEN = 1; addEventListener() {} close() {} send() {} }
  const controller = createBackgroundController({ chromeApi, WebSocketImpl: FakeSocket, randomId: () => 'opaque' });
  await controller.load();
  listeners.updated(42, { status: 'complete' }, tabsById[42]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.publicState().autoShareEnabled, false);
  assert.deepEqual(controller.publicState().sharedTabs, []);
});

test('auto-shares the active tab once enabled, and again when switching to another eligible tab', async () => {
  const { chromeApi, listeners, requests } = createAutoShareChromeApi();
  class FakeSocket { static OPEN = 1; addEventListener() {} close() {} send() {} }
  let counter = 0;
  const controller = createBackgroundController({ chromeApi, WebSocketImpl: FakeSocket, randomId: () => `opaque${counter++}` });
  await controller.load();
  const state = await controller.enableAutoShare();
  assert.equal(state.autoShareEnabled, true);
  assert.deepEqual(state.sharedTabs, [{ id: 'tab_opaque0', origin: 'https://example.test', title: 'Example' }]);
  assert.deepEqual(requests, [['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']]);

  listeners.activated({ tabId: 43 });
  await new Promise((resolve) => setImmediate(resolve));
  const after = controller.publicState();
  assert.equal(after.sharedTabs.length, 2);
  assert.ok(after.sharedTabs.some((tab) => tab.origin === 'https://second.test'));
  assert.equal(requests.length, 1);
});

test('auto-share fails safe when the granted broad permission does not cover the active tab origin', async () => {
  const { chromeApi, requests } = createAutoShareChromeApi({ containsResult: false });
  class FakeSocket { static OPEN = 1; addEventListener() {} close() {} send() {} }
  const controller = createBackgroundController({ chromeApi, WebSocketImpl: FakeSocket, randomId: () => 'opaque' });
  await controller.load();
  const state = await controller.enableAutoShare();
  assert.equal(state.autoShareEnabled, true);
  assert.deepEqual(state.sharedTabs, []);
  assert.deepEqual(requests, [['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']]);
});

test('disabling auto-share stops further automatic sharing but keeps already-shared tabs', async () => {
  const { chromeApi, listeners } = createAutoShareChromeApi();
  class FakeSocket { static OPEN = 1; addEventListener() {} close() {} send() {} }
  const controller = createBackgroundController({ chromeApi, WebSocketImpl: FakeSocket, randomId: () => 'opaque' });
  await controller.load();
  await controller.enableAutoShare();
  assert.equal(controller.publicState().sharedTabs.length, 1);
  const state = await controller.disableAutoShare();
  assert.equal(state.autoShareEnabled, false);
  listeners.activated({ tabId: 43 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.publicState().sharedTabs.length, 1);
});

test('does not nuke a fresh socket when the previous intentionally-closed socket fires close late', async () => {
  const stored = { browserBridge: { brokerUrl: 'ws://127.0.0.1:18766/extension', deviceKey: 'device_key', sharedTabs: {} } };
  const createdSockets = [];
  class FakeSocket {
    static OPEN = 1;
    constructor() {
      this.readyState = 0;
      this.listeners = {};
      this.sent = [];
      createdSockets.push(this);
    }
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
    close() {}
    send(message) { this.sent.push(JSON.parse(message)); }
    emit(type, event = {}) {
      if (type === 'open') this.readyState = FakeSocket.OPEN;
      for (const listener of this.listeners[type] ?? []) listener(event);
    }
  }
  const chromeApi = {
    storage: { local: { get: async () => stored, set: async () => {}, remove: async () => {} } },
    tabs: { onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {} } },
  };
  const controller = createBackgroundController({ chromeApi, WebSocketImpl: FakeSocket, randomId: () => 'opaque' });
  await controller.load();
  createdSockets[0].emit('open');

  // revoke() clears the device key and immediately reconnects, offering a
  // fresh pairing request on the new socket without any explicit pair() call.
  await controller.revoke();

  // At this point the controller should hold the second (permanent) socket:
  // no separate "pairing" socket is opened anymore, the same connection is
  // reused for request_pairing -> paired -> authenticate.
  assert.equal(createdSockets.length, 2);
  const permanentSocket = createdSockets[1];
  permanentSocket.emit('open');
  assert.deepEqual(permanentSocket.sent, [{ type: 'request_pairing' }]);
  permanentSocket.emit('message', { data: JSON.stringify({ type: 'paired', deviceKey: 'new_device_key' }) });
  await new Promise((resolve) => setImmediate(resolve));
  permanentSocket.emit('message', { data: JSON.stringify({ type: 'authenticated', connectionGeneration: 7 }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.publicState().connected, true);
  assert.equal(controller.publicState().connectionGeneration, 7);

  // Firing the original load() socket's stale close event must not clear the
  // permanent socket. Before the fix, `socket = null` would run here and break
  // the connection even though the new socket is healthy.
  createdSockets[0].emit('close');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.publicState().paired, true);
  assert.equal(controller.publicState().connected, true);
});

