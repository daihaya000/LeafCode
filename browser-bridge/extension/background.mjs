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
  let state = { brokerUrl: DEFAULT_BROKER_URL, deviceKey: null, sharedTabs: {}, autoShareEnabled: false };
  const intentionalCloses = new WeakSet();

  const persist = async () => chromeApi.storage.local.set({ [STORAGE_KEY]: state });
  const send = (message) => {
    if (socket?.readyState === WebSocketImpl.OPEN) socket.send(JSON.stringify(message));
  };

  async function load() {
    const stored = await chromeApi.storage.local.get(STORAGE_KEY);
    state = { ...state, ...(stored[STORAGE_KEY] ?? {}), sharedTabs: stored[STORAGE_KEY]?.sharedTabs ?? {} };
    if (state.deviceKey) connect();
    return publicState();
  }

  function connect() {
    if (!state.deviceKey || !isSafeBrokerSocketUrl(state.brokerUrl)) return;
    if (socket) {
      intentionalCloses.add(socket);
      socket.close();
    }
    socket = new WebSocketImpl(state.brokerUrl);
    socket.addEventListener('open', () => send({ type: 'authenticate', deviceKey: state.deviceKey }));
    socket.addEventListener('message', async (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'authenticated') {
        connectionGeneration = message.connectionGeneration;
        handledCommandIds = new Set();
        reconnectDelay = 500;
        for (const tab of Object.values(state.sharedTabs)) send({ type: 'tab_shared', tab });
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
    socket.addEventListener('close', (event) => {
      const closedSocket = event.target;
      const wasIntentional = intentionalCloses.has(closedSocket);
      intentionalCloses.delete(closedSocket);
      // Only clear `socket` if this event belongs to the currently held socket.
      // If connect() replaced the socket (intentional close before reconnect),
      // the new socket must not be nulled by the old one's close event.
      if (socket === closedSocket) socket = null;
      if (state.deviceKey && !reconnectTimer && !wasIntentional) {
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
  }

  async function pair({ brokerUrl = DEFAULT_BROKER_URL, code }) {
    if (!isSafeBrokerSocketUrl(brokerUrl) || typeof code !== 'string' || code.length < 20) throw new Error('ペアリング情報が不正です');
    state.brokerUrl = brokerUrl;
    const pairingSocket = new WebSocketImpl(brokerUrl);
    const paired = await new Promise((resolve, reject) => {
      pairingSocket.addEventListener('open', () => pairingSocket.send(JSON.stringify({ type: 'pair', code })));
      pairingSocket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'paired' && typeof message.deviceKey === 'string') resolve(message.deviceKey);
        else reject(new Error('Pairing rejected'));
      });
      pairingSocket.addEventListener('error', () => reject(new Error('Broker unavailable')));
    });
    pairingSocket.close();
    state.deviceKey = paired;
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
    return publicState();
  }

  function publicState() {
    return { paired: Boolean(state.deviceKey), connected: socket?.readyState === WebSocketImpl.OPEN, connectionGeneration, autoShareEnabled: Boolean(state.autoShareEnabled), sharedTabs: Object.values(state.sharedTabs).map(({ browserTabId, ...tab }) => tab) };
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
  return { load, pair, shareActiveTab, enableAutoShare, disableAutoShare, collectSnapshot, captureScreenshot, unshare, revoke, publicState };
}

if (globalThis.chrome?.runtime?.onMessage) {
  const controller = createBackgroundController({ chromeApi: globalThis.chrome, WebSocketImpl: globalThis.WebSocket });
  void controller.load();
  globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handlers = { status: controller.publicState, pair: () => controller.pair(message), share: controller.shareActiveTab, enableAutoShare: controller.enableAutoShare, disableAutoShare: controller.disableAutoShare, snapshot: () => controller.collectSnapshot(message.tabId), unshare: () => controller.unshare(message.tabId), revoke: controller.revoke };
    const handler = handlers[message?.action];
    if (!handler) return false;
    Promise.resolve(handler()).then((value) => sendResponse({ ok: true, value }), (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
}
