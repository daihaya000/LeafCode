import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBrowserBridgeManager } from './browser-bridge.js';

const ORIGIN = 'chrome-extension://abcdefghijklmnopqrstuvwx';
const DEVICE_KEY = 'abcdefghijklmnopqrstuvwxyz12';

function tempPairingFile() {
  return join(mkdtempSync(join(tmpdir(), 'ocw-bb-')), 'pairing.json');
}

function fakeBrokerFactory(events) {
  return (opts) => ({
    url: 'ws://127.0.0.1:18766',
    internalToken: 'tok',
    persistedPairing: opts.persistedPairing,
    onPairingChanged: opts.onPairingChanged,
    listen: async () => {
      events.push('listen');
    },
    close: async () => {
      events.push('close');
    },
  });
}

test('start then close does not throw TDZ and exposes broker env only while running', async () => {
  const events = [];
  const manager = createBrowserBridgeManager({
    pairingFile: tempPairingFile(),
    port: 18766,
    WebSocketServer: class {},
    createBroker: fakeBrokerFactory(events),
  });
  assert.deepEqual(manager.environment(), {});
  await manager.start();
  assert.deepEqual(manager.environment(), {
    LEAFCODE_BROWSER_BROKER: 'ws://127.0.0.1:18766',
    LEAFCODE_BROWSER_BROKER_TOKEN: 'tok',
    // Legacy names kept for pre-rebrand opencode.json MCP entries.
    OPENCODE_WEBUI_BROWSER_BROKER: 'ws://127.0.0.1:18766',
    OPENCODE_WEBUI_BROWSER_BROKER_TOKEN: 'tok',
  });
  await manager.close();
  assert.deepEqual(manager.environment(), {});
  assert.deepEqual(events, ['listen', 'close']);
});

test('start is a no-op when the broker is already running', async () => {
  let listens = 0;
  const manager = createBrowserBridgeManager({
    pairingFile: tempPairingFile(),
    port: 18766,
    WebSocketServer: class {},
    createBroker: () => ({
      url: 'ws://127.0.0.1:18766',
      internalToken: 'tok',
      listen: async () => {
        listens += 1;
      },
      close: async () => {},
    }),
  });
  await manager.start();
  await manager.start();
  assert.equal(listens, 1);
});

test('start restores a valid pairing file', async () => {
  const pairingFile = tempPairingFile();
  writeFileSync(
    pairingFile,
    JSON.stringify({ origin: ORIGIN, deviceKey: DEVICE_KEY }),
    'utf8',
  );
  /** @type {unknown} */
  let seen = undefined;
  const manager = createBrowserBridgeManager({
    pairingFile,
    port: 18766,
    WebSocketServer: class {},
    createBroker: (opts) => {
      seen = opts.persistedPairing;
      return {
        url: 'ws://127.0.0.1:18766',
        internalToken: 'tok',
        listen: async () => {},
        close: async () => {},
      };
    },
  });
  await manager.start();
  assert.deepEqual(seen, { origin: ORIGIN, deviceKey: DEVICE_KEY });
  rmSync(join(pairingFile, '..'), { recursive: true, force: true });
});

test('loadPairing rejects an invalid pairing file', () => {
  const pairingFile = tempPairingFile();
  writeFileSync(pairingFile, '{"origin":"https://evil.example"}', 'utf8');
  const manager = createBrowserBridgeManager({
    pairingFile,
    port: 18766,
    WebSocketServer: class {},
    createBroker: fakeBrokerFactory([]),
  });
  assert.equal(manager.loadPairing(), null);
});

test('savePairing writes then clear removes the pairing file', () => {
  const pairingFile = tempPairingFile();
  const manager = createBrowserBridgeManager({
    pairingFile,
    port: 18766,
    ensureDataDir: () => {},
    WebSocketServer: class {},
    createBroker: fakeBrokerFactory([]),
  });
  manager.savePairing({ origin: ORIGIN, deviceKey: DEVICE_KEY });
  assert.deepEqual(JSON.parse(readFileSync(pairingFile, 'utf8')), {
    origin: ORIGIN,
    deviceKey: DEVICE_KEY,
  });
  manager.savePairing(null);
  assert.equal(manager.loadPairing(), null);
});
