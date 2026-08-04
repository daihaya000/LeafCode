const STORAGE_KEY = 'browserBridge';
const DEFAULT_BROKER_URL = 'ws://127.0.0.1:18766/extension';
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

export function isSafeBrokerSocketUrl(value) {
  try {
    const url = new URL(value);
    return ['ws:', 'wss:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

const AUTO_SHARE_ORIGIN_PATTERNS = ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'];

function isShareableTabUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'https:') return url;
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) return url;
    return null;
  } catch {
    return null;
  }
}

export function createBackgroundController({ chromeApi, WebSocketImpl, randomId = () => crypto.randomUUID().replaceAll('-', '') }) {
  let socket = null;
  let connectionGeneration = 0;
  let reconnectTimer = null;
  let reconnectDelay = 500;
  let nextSnapshotGeneration = 1;
  let handledCommandIds = new Set();
  // Transient (non-persisted) flag: true while a 'request_pairing' has been
  // sent on the current socket and we're waiting for the WebUI to allow or
  // deny it. Reset whenever the socket closes/reconnects or pairing succeeds.
  let pairingRequested = false;
  let state = { brokerUrl: DEFAULT_BROKER_URL, deviceKey: null, sharedTabs: {}, autoShareEnabled: false };
  const intentionalCloses = new WeakSet();
  const hasWebSocket = typeof WebSocketImpl === 'function';

  const persist = async () => chromeApi.storage.local.set({ [STORAGE_KEY]: state });
  const send = (message) => {
    if (hasWebSocket && socket?.readyState === WebSocketImpl.OPEN) socket.send(JSON.stringify(message));
  };

  async function load() {
    const stored = await chromeApi.storage.local.get(STORAGE_KEY);
    state = { ...state, ...(stored[STORAGE_KEY] ?? {}), sharedTabs: stored[STORAGE_KEY]?.sharedTabs ?? {} };
    connect();
    return publicState();
  }

  function connect() {
    if (!hasWebSocket || !isSafeBrokerSocketUrl(state.brokerUrl)) return;
    if (socket) {
      intentionalCloses.add(socket);
      socket.close();
    }
    pairingRequested = false;
    socket = new WebSocketImpl(state.brokerUrl);
    socket.addEventListener('open', () => {
      // No pairing code to type: an unpaired extension just announces itself
      // and waits for a human to allow it from the local WebUI.
      if (state.deviceKey) {
        send({ type: 'authenticate', deviceKey: state.deviceKey });
      } else {
        send({ type: 'request_pairing' });
        pairingRequested = true;
      }
    });
    socket.addEventListener('message', async (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'authenticated') {
        connectionGeneration = message.connectionGeneration;
        handledCommandIds = new Set();
        reconnectDelay = 500;
        pairingRequested = false;
        // Re-validate persisted shared tabs before re-announcing them. A tab
        // closed while the extension socket was disconnected (service worker
        // idle, browser restart, crash, etc.) leaves a stale browserTabId in
        // chrome.storage.local. Re-announcing it would register a phantom tab
        // on the Broker that can never be snapshotted or controlled, and
        // never be unshared (no onRemoved fires for an already-closed tab).
        await pruneStaleSharedTabs();
        for (const tab of Object.values(state.sharedTabs)) send({ type: 'tab_shared', tab });
      } else if (message.type === 'paired' && typeof message.deviceKey === 'string') {
        // The WebUI allowed our pairing request. Persist the device key and
        // authenticate on the same still-open socket (no reconnect needed).
        state.deviceKey = message.deviceKey;
        await persist();
        send({ type: 'authenticate', deviceKey: message.deviceKey });
      } else if (message.type === 'pairing_requested') {
        pairingRequested = true;
      } else if (message.type === 'pairing_denied') {
        pairingRequested = false;
      } else if (message.type === 'snapshot_request' && typeof message.tabId === 'string') {
        void collectSnapshot(message.tabId).catch(() => {});
      } else if (message.type === 'command') {
        void executeCommand(message);
      } else if (message.type === 'error' && message.error === 'NOT_PAIRED') {
        // The Broker no longer recognizes this device (e.g. its pairing state
        // was lost, typically after a Broker restart without persisted
        // pairing). Retrying forever with the stale deviceKey would just loop
        // silently as "reconnecting" without ever telling the user to re-pair.
        void forgetPairing();
      }
    });
    // Errors are expected while the Broker is unavailable (e.g. during host
    // startup or after a network change). The close listener above already
    // schedules an exponential-backoff reconnect, so we just swallow the
    // error to avoid noisy unhandled-rejection reports in the extension console.
    socket.addEventListener('error', () => {});
    socket.addEventListener('close', (event) => {
      const closedSocket = event.target;
      const wasIntentional = intentionalCloses.has(closedSocket);
      intentionalCloses.delete(closedSocket);
      // Only clear `socket` if this event belongs to the currently held socket.
      // If connect() replaced the socket (intentional close before reconnect),
      // the new socket must not be nulled by the old one's close event.
      if (socket === closedSocket) {
        socket = null;
        pairingRequested = false;
      }
      if (!reconnectTimer && !wasIntentional) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      }
    });
  }

  async function forgetPairing() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket) {
      intentionalCloses.add(socket);
      socket.close();
      socket = null;
    }
    reconnectDelay = 500;
    state = { ...state, deviceKey: null };
    await persist();
    // Immediately offer a fresh pairing request so re-approving from the
    // WebUI is the only step needed to recover (no popup interaction).
    connect();
  }

  async function setBrokerUrl(url) {
    if (!isSafeBrokerSocketUrl(url)) throw new Error('Broker URL が不正です');
    state.brokerUrl = url;
    await persist();
    connect();
    return publicState();
  }

  async function shareActiveTab() {
    const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) throw new Error('アクティブなタブがありません');
    const url = isShareableTabUrl(tab.url);
    if (!url) throw new Error('このページは共有できません');
    const originPattern = `${url.origin}/*`;
    const granted = await chromeApi.permissions.request({ origins: [originPattern] });
    if (!granted) throw new Error('サイト権限が許可されませんでした');
    const id = `tab_${randomId()}`;
    const shared = { id, origin: url.origin, title: String(tab.title ?? '').slice(0, 512) };
    state.sharedTabs[id] = { ...shared, browserTabId: tab.id };
    await persist();
    send({ type: 'tab_shared', tab: shared });
    return publicState();
  }

  async function enableAutoShare() {
    const granted = await chromeApi.permissions.request({ origins: AUTO_SHARE_ORIGIN_PATTERNS });
    if (!granted) throw new Error('広範なサイト権限が許可されませんでした');
    state.autoShareEnabled = true;
    await persist();
    const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
    if (tab) await autoShareTab(tab);
    return publicState();
  }

  async function disableAutoShare() {
    state.autoShareEnabled = false;
    await persist();
    return publicState();
  }

  async function autoShareTab(tab) {
    if (!state.autoShareEnabled || !tab?.id || !tab.url || tab.active !== true) return;
    if (Object.values(state.sharedTabs).some((shared) => shared.browserTabId === tab.id)) return;
    const url = isShareableTabUrl(tab.url);
    if (!url) return;
    const granted = await chromeApi.permissions.contains({ origins: [`${url.origin}/*`] });
    if (!granted) return;
    const id = `tab_${randomId()}`;
    const shared = { id, origin: url.origin, title: String(tab.title ?? '').slice(0, 512) };
    state.sharedTabs[id] = { ...shared, browserTabId: tab.id };
    await persist();
    send({ type: 'tab_shared', tab: shared });
  }

  async function unshare(tabId) {
    const shared = state.sharedTabs[tabId];
    if (!shared) return publicState();
    delete state.sharedTabs[tabId];
    await persist();
    send({ type: 'tab_unshared', tabId });
    return publicState();
  }

  // Drop persisted shared tabs whose browserTabId no longer resolves to a
  // live Chrome tab. Called on `authenticated` so a browser restart (or any
  // disconnection that outlived a tab close) cannot leave phantom tabs that
  // the Broker accepts but can never operate on. Reuses `unshare()` so
  // persistence, `tab_unshared` delivery, and `publicState` stay consistent.
  async function pruneStaleSharedTabs() {
    if (typeof chromeApi.tabs.get !== 'function') return;
    const stale = [];
    for (const [tabId, shared] of Object.entries(state.sharedTabs)) {
      try {
        const tab = await chromeApi.tabs.get(shared.browserTabId);
        if (!tab?.id) throw new Error('tab gone');
      } catch {
        stale.push(tabId);
      }
    }
    for (const tabId of stale) await unshare(tabId);
  }

  async function collectSnapshot(tabId) {
    const shared = state.sharedTabs[tabId];
    if (!shared) throw new Error('タブが共有されていません');
    await chromeApi.scripting.executeScript({ target: { tabId: shared.browserTabId }, files: ['extension/content-runtime.js'] });
    const snapshot = await chromeApi.tabs.sendMessage(shared.browserTabId, {
      type: 'browser_bridge_collect_snapshot', snapshotGeneration: nextSnapshotGeneration++,
    });
    if (!snapshot || !Array.isArray(snapshot.nodes)) throw new Error('スナップショットの取得に失敗しました');
    send({ type: 'snapshot', tabId, snapshot });
    return snapshot;
  }

  async function captureScreenshot(tabId) {
    const shared = state.sharedTabs[tabId];
    if (!shared) throw new Error('タブが共有されていません');
    const tab = await chromeApi.tabs.get(shared.browserTabId);
    if (!tab?.active || !Number.isInteger(tab.windowId)) throw new Error('共有タブがアクティブでないため撮影できません');
    const dataUrl = await chromeApi.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '');
    if (!match || Math.floor((match[2].length * 3) / 4) > MAX_SCREENSHOT_BYTES) throw new Error('スクリーンショットが許容サイズを超えています');
    return { mimeType: match[1], data: match[2] };
  }

  async function executeCommand(command) {
    if (command.connectionGeneration !== connectionGeneration || !['browser_click', 'browser_type', 'browser_scroll', 'browser_navigate', 'browser_screenshot'].includes(command.tool)) return;
    if (typeof command.commandId !== 'string' || handledCommandIds.has(command.commandId)) return;
    handledCommandIds.add(command.commandId);
    const shared = state.sharedTabs[command.args?.tabId];
    if (!shared) return;
    try {
      if (command.tool === 'browser_screenshot') {
        const image = await captureScreenshot(command.args.tabId);
        send({ protocolVersion: 1, type: 'result', commandId: command.commandId, connectionGeneration, state: 'succeeded', result: { image } });
        return;
      }
      const result = await chromeApi.tabs.sendMessage(shared.browserTabId, {
        type: command.tool === 'browser_click' ? 'browser_bridge_click' : command.tool === 'browser_type' ? 'browser_bridge_type' : command.tool === 'browser_scroll' ? 'browser_bridge_scroll' : 'browser_bridge_navigate',
        ref: command.args.ref,
        snapshotGeneration: command.args.snapshotGeneration,
        ...(command.tool === 'browser_type' ? { text: command.args.text, append: command.args.append === true } : {}),
        ...(command.tool === 'browser_scroll' ? { direction: command.args.direction, amount: command.args.amount } : {}),
        ...(command.tool === 'browser_navigate' ? { url: command.args.url } : {}),
      });
      send({ protocolVersion: 1, type: 'result', commandId: command.commandId, connectionGeneration, state: result?.ok ? 'succeeded' : 'failed', ...(result?.ok ? { result: {} } : { error: { code: result?.error === 'STALE_REFERENCE' ? 'STALE_REFERENCE' : 'POLICY_BLOCKED', message: 'Command was not executed' } }) });
    } catch {
      send({ protocolVersion: 1, type: 'result', commandId: command.commandId, connectionGeneration, state: 'failed', error: { code: 'EXTENSION_DISCONNECTED', message: 'Command delivery failed' } });
    }
  }

  async function revoke() {
    for (const tabId of Object.keys(state.sharedTabs)) send({ type: 'tab_unshared', tabId });
    send({ type: 'unpair' });
    state = { brokerUrl: DEFAULT_BROKER_URL, deviceKey: null, sharedTabs: {}, autoShareEnabled: false };
    await chromeApi.storage.local.remove(STORAGE_KEY);
    if (socket) {
      intentionalCloses.add(socket);
      socket.close();
      socket = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    // Immediately offer a fresh pairing request; the WebUI must still
    // explicitly allow it before any access is granted again.
    connect();
    return publicState();
  }

  function publicState() {
    return {
      paired: Boolean(state.deviceKey),
      connected: hasWebSocket && socket?.readyState === WebSocketImpl.OPEN,
      pairingRequested,
      connectionGeneration,
      autoShareEnabled: Boolean(state.autoShareEnabled),
      sharedTabs: Object.values(state.sharedTabs).map(({ browserTabId, ...tab }) => tab),
    };
  }

  chromeApi.tabs.onRemoved.addListener((browserTabId) => {
    const shared = Object.entries(state.sharedTabs).find(([, tab]) => tab.browserTabId === browserTabId);
    if (shared) void unshare(shared[0]);
  });
  chromeApi.tabs.onUpdated.addListener((browserTabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading') {
      const shared = Object.entries(state.sharedTabs).find(([, sharedTab]) => sharedTab.browserTabId === browserTabId);
      if (shared) void unshare(shared[0]);
    } else if (changeInfo.status === 'complete') {
      void autoShareTab(tab);
    }
  });
  chromeApi.tabs.onActivated?.addListener(({ tabId }) => {
    void (async () => {
      if (!state.autoShareEnabled) return;
      const tab = await chromeApi.tabs.get(tabId).catch(() => null);
      if (tab?.status === 'complete') await autoShareTab(tab);
    })();
  });
  return { load, setBrokerUrl, shareActiveTab, enableAutoShare, disableAutoShare, collectSnapshot, captureScreenshot, unshare, revoke, publicState };
}

if (globalThis.chrome?.runtime?.onMessage) {
  const controller = createBackgroundController({ chromeApi: globalThis.chrome, WebSocketImpl: globalThis.WebSocket });
  void controller.load();
  globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handlers = { status: controller.publicState, setBrokerUrl: () => controller.setBrokerUrl(message.brokerUrl), share: controller.shareActiveTab, enableAutoShare: controller.enableAutoShare, disableAutoShare: controller.disableAutoShare, snapshot: () => controller.collectSnapshot(message.tabId), unshare: () => controller.unshare(message.tabId), revoke: controller.revoke };
    const handler = handlers[message?.action];
    if (!handler) return false;
    Promise.resolve(handler()).then((value) => sendResponse({ ok: true, value }), (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
}
