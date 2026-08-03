import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { BrowserBridgeErrorCode } from '../shared/errors.mjs';
import { BrowserToolName, MAX_MESSAGE_BYTES, validateToolInput } from '../shared/schemas.mjs';
import { validateResultEnvelope } from '../shared/protocol.mjs';
import { evaluateCommandPolicy } from './policy.mjs';
import { AuditLog } from './audit.mjs';

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
  snapshotRequestTimeoutMs = 10_000,
  approvalTimeoutMs = 30_000,
  commandTimeoutMs = 30_000,
  persistedPairing = null,
  onPairingChanged = () => {},
} = {}) {
  if (typeof internalToken !== 'string' || internalToken.length < 32) {
    throw new TypeError('Browser Bridge internal token must be at least 32 characters');
  }
  if (typeof WebSocketServer !== 'function') throw new TypeError('WebSocketServer is required');
  if (typeof now !== 'function' || !Number.isSafeInteger(pairingTtlMs) || pairingTtlMs < 1) {
    throw new TypeError('Invalid Broker clock or pairing TTL');
  }
  if (!Number.isSafeInteger(approvalTimeoutMs) || approvalTimeoutMs < 1 || !Number.isSafeInteger(commandTimeoutMs) || commandTimeoutMs < 1) {
    throw new TypeError('Invalid Broker command timeout');
  }
  if (typeof onPairingChanged !== 'function') throw new TypeError('Invalid Broker pairing callback');
  if (persistedPairing !== null && !validPersistedPairing(persistedPairing)) throw new TypeError('Invalid persisted pairing');

  let pairedOrigin = persistedPairing?.origin ?? null;
  let deviceKey = persistedPairing?.deviceKey ?? null;
  let extensionSocket = null;
  let connectionGeneration = 0;
  // A pairing request is created when an unauthenticated extension socket
  // asks to be paired. It stays pending until a human explicitly allows or
  // denies it from the local WebUI (no code to copy/type).
  const pendingPairingRequests = new Map();
  const socketPairingRequestId = new WeakMap();
  const sharedTabs = new Map();
  const snapshots = new Map();
  const pendingSnapshots = new Map();
  const pendingApprovals = new Map();
  const dispatchedCommands = new Map();
  const screenshots = new Map();
  const audit = new AuditLog({ now });
  let listening = false;

  const persistPairing = () => {
    Promise.resolve(onPairingChanged(
      pairedOrigin && deviceKey ? { origin: pairedOrigin, deviceKey } : null,
    )).catch(() => {});
  };

  const status = () => ({
    extension: { connected: extensionSocket !== null, paired: pairedOrigin !== null },
    pendingApprovals: pendingApprovals.size,
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
    if (req.method === 'GET' && url.pathname === '/internal/pairing-requests') {
      json(res, 200, {
        requests: [...pendingPairingRequests.values()].map(({ requestId, origin: requestOrigin, createdAt }) => ({ requestId, origin: requestOrigin, createdAt })),
      });
      return;
    }
    const pairingMatch = /^\/internal\/pairing-requests\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (req.method === 'POST' && pairingMatch) {
      const request = pendingPairingRequests.get(pairingMatch[1]);
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        const code = error?.message === 'payload_too_large'
          ? BrowserBridgeErrorCode.PAYLOAD_TOO_LARGE
          : BrowserBridgeErrorCode.INVALID_REQUEST;
        json(res, code === BrowserBridgeErrorCode.PAYLOAD_TOO_LARGE ? 413 : 400, { error: { code } });
        return;
      }
      if (!request) {
        json(res, 404, { error: 'not_found' });
      } else if (!body || !['allow', 'deny'].includes(body.decision)) {
        json(res, 400, { error: { code: BrowserBridgeErrorCode.INVALID_REQUEST } });
      } else {
        pendingPairingRequests.delete(request.requestId);
        clearTimeout(request.timer);
        socketPairingRequestId.delete(request.socket);
        if (request.socket.readyState === 1) {
          if (body.decision === 'allow') {
            pairedOrigin = request.origin;
            deviceKey = createSecret();
            persistPairing();
            request.socket.send(JSON.stringify({ type: 'paired', deviceKey }));
          } else {
            request.socket.send(JSON.stringify({ type: 'pairing_denied' }));
            request.socket.close(1000, 'pairing_denied');
          }
        }
        json(res, 200, { requestId: request.requestId, decision: body.decision });
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/internal/approvals') {
      json(res, 200, { approvals: [...pendingApprovals.values()].map(({ args, timer, ...approval }) => approval) });
      return;
    }
    const approvalMatch = /^\/internal\/approvals\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (req.method === 'POST' && approvalMatch) {
      const approval = pendingApprovals.get(approvalMatch[1]);
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        const code = error?.message === 'payload_too_large'
          ? BrowserBridgeErrorCode.PAYLOAD_TOO_LARGE
          : BrowserBridgeErrorCode.INVALID_REQUEST;
        json(res, code === BrowserBridgeErrorCode.PAYLOAD_TOO_LARGE ? 413 : 400, { error: { code } });
        return;
      }
      if (!approval) {
        json(res, 404, { error: 'not_found' });
      } else if (!body || !['allow', 'deny'].includes(body.decision)) {
        json(res, 400, { error: { code: BrowserBridgeErrorCode.INVALID_REQUEST } });
      } else {
        pendingApprovals.delete(approval.approvalId);
        clearTimeout(approval.timer);
        if (body.decision === 'allow' && extensionSocket && sharedTabs.has(approval.tabId)) {
          const command = { ...approval, connectionGeneration, timer: setTimeout(() => dispatchedCommands.delete(approval.approvalId), commandTimeoutMs) };
          dispatchedCommands.set(approval.approvalId, command);
          extensionSocket.send(JSON.stringify({
            protocolVersion: 1,
            type: 'command',
            commandId: approval.approvalId,
            connectionGeneration,
            tool: approval.tool,
            args: approval.args,
          }));
        }
        json(res, 200, { approvalId: approval.approvalId, decision: body.decision });
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/internal/audit') {
      json(res, 200, { entries: audit.list() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/internal/tabs') {
      json(res, 200, { tabs: [...sharedTabs.values()] });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/internal/revoke') {
      // Revoke the active pairing: clears device key, shared tabs, pending
      // approvals, and tells the extension (if connected) to unpair.
      pairedOrigin = null;
      deviceKey = null;
      sharedTabs.clear();
      snapshots.clear();
      screenshots.clear();
      for (const approval of pendingApprovals.values()) clearTimeout(approval.timer);
      pendingApprovals.clear();
      for (const command of dispatchedCommands.values()) clearTimeout(command.timer);
      dispatchedCommands.clear();
      persistPairing();
      if (extensionSocket && extensionSocket.readyState === 1) {
        extensionSocket.send(JSON.stringify({ type: 'revoked' }));
        extensionSocket.close(1000, 'revoked');
        extensionSocket = null;
      }
      audit.record({
        commandId: 'revoke',
        tool: 'revoke',
        origin: 'local',
        outcome: 'revoked',
      });
      json(res, 200, { revoked: true });
      return;
    }
    const tool = /^\/internal\/tools\/([^/]+)$/.exec(url.pathname)?.[1];
    if (req.method === 'POST' && tool) {
      let args;
      try {
        args = validateToolInput(tool, await readJsonBody(req));
      } catch (error) {
        const code = error?.message === 'payload_too_large'
          ? BrowserBridgeErrorCode.PAYLOAD_TOO_LARGE
          : BrowserBridgeErrorCode.INVALID_REQUEST;
        json(res, code === BrowserBridgeErrorCode.PAYLOAD_TOO_LARGE ? 413 : 400, { error: { code } });
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
      if (tool === BrowserToolName.SNAPSHOT) {
        if (!sharedTabs.has(args.tabId)) {
          json(res, 404, { error: { code: BrowserBridgeErrorCode.TAB_NOT_SHARED } });
          return;
        }
        try {
          json(res, 200, await requestSnapshot(args.tabId));
        } catch {
          json(res, 504, { error: { code: BrowserBridgeErrorCode.COMMAND_TIMEOUT } });
        }
        return;
      }
      if (tool === BrowserToolName.SCREENSHOT && screenshots.has(args.tabId)) {
        const image = screenshots.get(args.tabId);
        screenshots.delete(args.tabId);
        json(res, 200, { image });
        return;
      }
      if ([BrowserToolName.CLICK, BrowserToolName.TYPE, BrowserToolName.SCROLL, BrowserToolName.NAVIGATE, BrowserToolName.SCREENSHOT].includes(tool)) {
        const policy = evaluateCommandPolicy({
          tool,
          tab: { shared: sharedTabs.has(args.tabId), lowRiskAllowed: false },
        });
        if (policy.decision === 'deny') {
          json(res, 403, { error: { code: policy.code } });
          return;
        }
        const approvalId = `approval_${createSecret()}`;
        pendingApprovals.set(approvalId, {
          approvalId,
          tool,
          tabId: args.tabId,
          origin: sharedTabs.get(args.tabId).origin,
          createdAt: now(),
          args,
          timer: setTimeout(() => pendingApprovals.delete(approvalId), approvalTimeoutMs),
        });
        json(res, 428, { error: { code: BrowserBridgeErrorCode.APPROVAL_REQUIRED, approvalId } });
        return;
      }
      json(res, 503, { error: { code: BrowserBridgeErrorCode.EXTENSION_DISCONNECTED } });
      return;
    }
    json(res, 404, { error: 'not_found' });
  });

  function requestSnapshot(tabId) {
    if (pendingSnapshots.has(tabId)) return pendingSnapshots.get(tabId).promise;
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    const timer = setTimeout(() => {
      pendingSnapshots.delete(tabId);
      reject(new Error('snapshot timeout'));
    }, snapshotRequestTimeoutMs);
    pendingSnapshots.set(tabId, { promise, resolve, reject, timer });
    extensionSocket.send(JSON.stringify({ type: 'snapshot_request', tabId }));
    return promise;
  }

  function saveSnapshot(tabId, snapshot) {
    snapshots.set(tabId, snapshot);
    const pending = pendingSnapshots.get(tabId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingSnapshots.delete(tabId);
      pending.resolve(snapshot);
    }
  }

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
    socket.on('close', () => {
      const requestId = socketPairingRequestId.get(socket);
      if (requestId) {
        const request = pendingPairingRequests.get(requestId);
        clearTimeout(request?.timer);
        pendingPairingRequests.delete(requestId);
        socketPairingRequestId.delete(socket);
      }
    });
    socket.on('message', (raw, isBinary) => {
      if (isBinary) return rejectSocket(socket, 'invalid_message');
      const message = parseMessage(raw.toString());
      if (!message) return rejectSocket(socket, 'invalid_message');
      if (authenticated) {
        if (message.type === 'unpair' && Object.keys(message).length === 1) {
          pairedOrigin = null;
          deviceKey = null;
          persistPairing();
          socket.close(1000, 'unpaired');
          return;
        }
        if (message.type === 'tab_shared' && Object.keys(message).length === 2 && validSharedTab(message.tab)) {
          sharedTabs.set(message.tab.id, message.tab);
          return;
        }
        if (message.type === 'tab_unshared' && Object.keys(message).length === 2 && validOpaqueId(message.tabId)) {
          sharedTabs.delete(message.tabId);
          snapshots.delete(message.tabId);
          for (const [approvalId, approval] of pendingApprovals) {
            if (approval.tabId === message.tabId) {
              clearTimeout(approval.timer);
              pendingApprovals.delete(approvalId);
            }
          }
          return;
        }
        if (message.type === 'snapshot' && Object.keys(message).length === 3 && sharedTabs.has(message.tabId) && validSnapshot(message.snapshot)) {
          saveSnapshot(message.tabId, message.snapshot);
          return;
        }
        if (message.type === 'result') {
          try {
            validateResultEnvelope(message);
            const command = dispatchedCommands.get(message.commandId);
            if (command && command.connectionGeneration !== message.connectionGeneration) {
              return rejectSocket(socket, 'stale_result');
            }
            if (command) {
              dispatchedCommands.delete(message.commandId);
              clearTimeout(command.timer);
              if (command.tool === BrowserToolName.SCREENSHOT && validImage(message.result?.image)) {
                screenshots.set(command.tabId, message.result.image);
              }
              audit.record({
                commandId: message.commandId,
                tool: command.tool,
                origin: command.origin,
                outcome: message.state,
                approval: 'single',
              });
            }
            return;
          } catch {
            return rejectSocket(socket, 'invalid_result');
          }
        }
        if (message.type === 'heartbeat' && Object.keys(message).length === 1) {
          socket.send(JSON.stringify({ type: 'heartbeat_ack', connectionGeneration }));
          return;
        }
        return rejectSocket(socket, 'invalid_message');
      }

      if (message.type === 'request_pairing' && Object.keys(message).length === 1) {
        const existingRequestId = socketPairingRequestId.get(socket);
        if (existingRequestId) {
          socket.send(JSON.stringify({ type: 'pairing_requested', requestId: existingRequestId }));
          return;
        }
        const requestId = `pairing_request_${createSecret()}`;
        const timer = setTimeout(() => {
          pendingPairingRequests.delete(requestId);
          socketPairingRequestId.delete(socket);
          rejectSocket(socket, 'pairing_request_expired');
        }, pairingTtlMs);
        pendingPairingRequests.set(requestId, { requestId, origin, socket, createdAt: now(), timer });
        socketPairingRequestId.set(socket, requestId);
        socket.send(JSON.stringify({ type: 'pairing_requested', requestId }));
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
            snapshots.clear();
            screenshots.clear();
            for (const approval of pendingApprovals.values()) clearTimeout(approval.timer);
            pendingApprovals.clear();
            for (const command of dispatchedCommands.values()) clearTimeout(command.timer);
            dispatchedCommands.clear();
            for (const pending of pendingSnapshots.values()) {
              clearTimeout(pending.timer);
              pending.reject(new Error('extension disconnected'));
            }
            pendingSnapshots.clear();
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
      for (const request of pendingPairingRequests.values()) clearTimeout(request.timer);
      pendingPairingRequests.clear();
      for (const approval of pendingApprovals.values()) clearTimeout(approval.timer);
      pendingApprovals.clear();
      for (const command of dispatchedCommands.values()) clearTimeout(command.timer);
      dispatchedCommands.clear();
      for (const pending of pendingSnapshots.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('broker shutdown'));
      }
      pendingSnapshots.clear();
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

function validPersistedPairing(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 2
    && typeof value.origin === 'string'
    && /^chrome-extension:\/\/[a-z]{16,64}$/.test(value.origin)
    && typeof value.deviceKey === 'string'
    && /^[A-Za-z0-9_-]{20,}$/.test(value.deviceKey);
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

function validImage(image) {
  return image !== null && typeof image === 'object' && !Array.isArray(image)
    && ['image/png', 'image/jpeg'].includes(image.mimeType)
    && typeof image.data === 'string'
    && /^[A-Za-z0-9+/=]+$/.test(image.data)
    && Math.floor((image.data.length * 3) / 4) <= 4 * 1024 * 1024;
}

function validSnapshot(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  if (!Number.isSafeInteger(snapshot.snapshotGeneration) || snapshot.snapshotGeneration < 1 || typeof snapshot.truncated !== 'boolean' || !Array.isArray(snapshot.nodes) || snapshot.nodes.length > 100) return false;
  return snapshot.nodes.every((node) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node) || Object.keys(node).some((key) => !['ref', 'role', 'name', 'text', 'hasValue'].includes(key))) return false;
    return validOpaqueId(node.ref)
      && typeof node.role === 'string' && node.role.length <= 128
      && typeof node.name === 'string' && node.name.length <= 256
      && (node.text === undefined || typeof node.text === 'string' && node.text.length <= 8_000)
      && (node.hasValue === undefined || typeof node.hasValue === 'boolean');
  });
}
