import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { BrowserBridgeErrorCode } from '../shared/errors.mjs';
import { BrowserToolName, MAX_MESSAGE_BYTES, validateToolInput } from '../shared/schemas.mjs';

const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

function createSecret() {
  return randomBytes(32).toString('base64url');
}

function constantTimeEquals(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isExtensionOrigin(raw) {
  try {
    const origin = new URL(raw);
    return origin.protocol === 'chrome-extension:' && /^[a-z]{8,64}$/.test(origin.hostname);
  } catch {
    return false;
  }
}

function json(res, status, payload) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(payload));
}

function internalAuthorized(req, token) {
  const expected = `Bearer ${token}`;
  return constantTimeEquals(req.headers.authorization ?? '', expected);
}

function parseMessage(raw) {
  if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) return null;
  try {
    const value = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_MESSAGE_BYTES) {
      throw new Error('payload_too_large');
    }
    chunks.push(chunk);
  }
  return parseMessage(Buffer.concat(chunks).toString());
}

/**
 * Creates the local-only bridge transport. WebSocketServer is injected so the
 * host owns the ws dependency while this package stays independently testable.
 */
export function createBrowserBridgeBroker({
  internalToken = createSecret(),
  WebSocketServer,
  now = Date.now,
  pairingTtlMs = 5 * 60_000,
} = {}) {
  if (typeof internalToken !== 'string' || internalToken.length < 32) {
    throw new TypeError('Browser Bridge internal token must be at least 32 characters');
  }
  if (typeof WebSocketServer !== 'function') throw new TypeError('WebSocketServer is required');
  if (typeof now !== 'function' || !Number.isSafeInteger(pairingTtlMs) || pairingTtlMs < 1) {
    throw new TypeError('Invalid Broker clock or pairing TTL');
  }

  let pairing = null;
  let pairedOrigin = null;
  let deviceKey = null;
  let extensionSocket = null;
  let connectionGeneration = 0;
  const sharedTabs = new Map();
  let listening = false;

  const status = () => ({
    extension: { connected: extensionSocket !== null, paired: pairedOrigin !== null },
    pendingApprovals: 0,
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/internal/')) {
      json(res, 404, { error: 'not_found' });
      return;
    }
    if (!internalAuthorized(req, internalToken)) {
      json(res, 401, { error: 'unauthorized' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/internal/status') {
      json(res, 200, status());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/internal/pairing') {
      pairing = { code: createSecret(), expiresAt: now() + pairingTtlMs };
      json(res, 201, { code: pairing.code, expiresAt: pairing.expiresAt });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/internal/approvals') {
      json(res, 200, { approvals: [] });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/internal/audit') {
      json(res, 200, { entries: [] });
      return;
    }
    const tool = /^\/internal\/tools\/([^/]+)$/.exec(url.pathname)?.[1];
    if (req.method === 'POST' && tool) {
      let args;
      try {
        args = validateToolInput(tool, await readJsonBody(req));
      } catch {
        json(res, 400, { error: { code: BrowserBridgeErrorCode.INVALID_REQUEST } });
        return;
      }
      if (tool === BrowserToolName.STATUS) {
        json(res, 200, status());
        return;
      }
      if (tool === BrowserToolName.LIST_TABS && extensionSocket) {
        json(res, 200, { tabs: [...sharedTabs.values()] });
        return;
      }
      if (!extensionSocket) {
        json(res, 503, { error: { code: BrowserBridgeErrorCode.EXTENSION_DISCONNECTED } });
        return;
      }
      // The extension command dispatcher is introduced with the shared-tab
      // implementation. Until then, do not pretend that a connected browser
      // has returned page data.
      void args;
      json(res, 503, { error: { code: BrowserBridgeErrorCode.EXTENSION_DISCONNECTED } });
      return;
    }
    json(res, 404, { error: 'not_found' });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const origin = req.headers.origin ?? '';
    if (url.pathname !== '/extension' || !isExtensionOrigin(origin)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, origin);
    });
  });

  wss.on('connection', (socket, _req, origin) => {
    let authenticated = false;
    socket.on('message', (raw, isBinary) => {
      if (isBinary) return rejectSocket(socket, 'invalid_message');
      const message = parseMessage(raw.toString());
      if (!message) return rejectSocket(socket, 'invalid_message');
      if (authenticated) {
        if (message.type === 'tab_shared' && Object.keys(message).length === 2 && validSharedTab(message.tab)) {
          sharedTabs.set(message.tab.id, message.tab);
          return;
        }
        if (message.type === 'tab_unshared' && Object.keys(message).length === 2 && validOpaqueId(message.tabId)) {
          sharedTabs.delete(message.tabId);
          return;
        }
        if (message.type === 'heartbeat' && Object.keys(message).length === 1) {
          socket.send(JSON.stringify({ type: 'heartbeat_ack', connectionGeneration }));
          return;
        }
        return rejectSocket(socket, 'invalid_message');
      }

      if (message.type === 'pair' && Object.keys(message).length === 2 && typeof message.code === 'string') {
        if (!pairing || now() > pairing.expiresAt || !constantTimeEquals(message.code, pairing.code)) {
          return rejectSocket(socket, 'invalid_pairing');
        }
        pairing = null;
        pairedOrigin = origin;
        deviceKey = createSecret();
        socket.send(JSON.stringify({ type: 'paired', deviceKey }));
        return;
      }

      if (
        message.type === 'authenticate' &&
        Object.keys(message).length === 2 &&
        pairedOrigin === origin &&
        typeof message.deviceKey === 'string' &&
        deviceKey !== null &&
        constantTimeEquals(message.deviceKey, deviceKey)
      ) {
        authenticated = true;
        extensionSocket?.close(1000, 'replaced');
        extensionSocket = socket;
        connectionGeneration += 1;
        socket.send(JSON.stringify({ type: 'authenticated', connectionGeneration }));
        socket.on('close', () => {
          if (extensionSocket === socket) {
            extensionSocket = null;
            sharedTabs.clear();
          }
        });
        return;
      }
      rejectSocket(socket, 'authentication_failed');
    });
    socket.on('error', () => {});
  });

  return {
    get internalToken() {
      return internalToken;
    },
    get url() {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Broker is not listening');
      return `http://127.0.0.1:${address.port}`;
    },
    get wsUrl() {
      return `${this.url.replace(/^http/, 'ws')}/extension`;
    },
    async listen(port) {
      if (listening) throw new Error('Broker is already listening');
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      listening = true;
    },
    async close() {
      if (!listening) return;
      extensionSocket?.close(1001, 'broker_shutdown');
      extensionSocket = null;
      await new Promise((resolve) => server.close(() => resolve()));
      wss.close();
      listening = false;
    },
  };
}

function rejectSocket(socket, error) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify({ type: 'error', error: BrowserBridgeErrorCode.NOT_PAIRED }));
    socket.close(1008, error);
  }
}

function validOpaqueId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}

function validSharedTab(tab) {
  if (tab === null || typeof tab !== 'object' || Array.isArray(tab) || Object.keys(tab).some((key) => !['id', 'origin', 'title'].includes(key))) return false;
  if (!validOpaqueId(tab.id) || typeof tab.title !== 'string' || tab.title.length > 512) return false;
  try {
    return new URL(tab.origin).protocol === 'https:';
  } catch {
    return false;
  }
}
