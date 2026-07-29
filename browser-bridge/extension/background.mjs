const STORAGE_KEY = 'browserBridge';
const DEFAULT_BROKER_URL = 'ws://127.0.0.1:18766/extension';

export function isSafeBrokerSocketUrl(value) {
  try {
    const url = new URL(value);
    return ['ws:', 'wss:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function createBackgroundController({ chromeApi, WebSocketImpl, randomId = () => crypto.randomUUID().replaceAll('-', '') }) {
  let socket = null;
  let connectionGeneration = 0;
  let reconnectTimer = null;
  let reconnectDelay = 500;
  let state = { brokerUrl: DEFAULT_BROKER_URL, deviceKey: null, sharedTabs: {} };

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
    socket?.close();
    socket = new WebSocketImpl(state.brokerUrl);
    socket.addEventListener('open', () => send({ type: 'authenticate', deviceKey: state.deviceKey }));
    socket.addEventListener('message', async (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'authenticated') {
        connectionGeneration = message.connectionGeneration;
        reconnectDelay = 500;
        for (const tab of Object.values(state.sharedTabs)) send({ type: 'tab_shared', tab });
      }
    });
    socket.addEventListener('close', () => {
      socket = null;
      if (state.deviceKey && !reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      }
    });
  }

  async function pair({ brokerUrl = DEFAULT_BROKER_URL, code }) {
    if (!isSafeBrokerSocketUrl(brokerUrl) || typeof code !== 'string' || code.length < 20) throw new Error('Invalid pairing input');
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
    if (!tab?.id || !tab.url) throw new Error('No active tab');
    const url = new URL(tab.url);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
      throw new Error('This page cannot be shared');
    }
    const originPattern = `${url.origin}/*`;
    const granted = await chromeApi.permissions.request({ origins: [originPattern] });
    if (!granted) throw new Error('Site permission was not granted');
    const id = `tab_${randomId()}`;
    const shared = { id, origin: url.origin, title: String(tab.title ?? '').slice(0, 512) };
    state.sharedTabs[id] = { ...shared, browserTabId: tab.id };
    await persist();
    send({ type: 'tab_shared', tab: shared });
    return publicState();
  }

  async function unshare(tabId) {
    const shared = state.sharedTabs[tabId];
    if (!shared) return publicState();
    delete state.sharedTabs[tabId];
    await persist();
    send({ type: 'tab_unshared', tabId });
    return publicState();
  }

  async function revoke() {
    for (const tabId of Object.keys(state.sharedTabs)) send({ type: 'tab_unshared', tabId });
    state = { brokerUrl: DEFAULT_BROKER_URL, deviceKey: null, sharedTabs: {} };
    await chromeApi.storage.local.remove(STORAGE_KEY);
    socket?.close();
    return publicState();
  }

  function publicState() {
    return { paired: Boolean(state.deviceKey), connected: socket?.readyState === WebSocketImpl.OPEN, connectionGeneration, sharedTabs: Object.values(state.sharedTabs).map(({ browserTabId, ...tab }) => tab) };
  }

  chromeApi.tabs.onRemoved.addListener((browserTabId) => {
    const shared = Object.entries(state.sharedTabs).find(([, tab]) => tab.browserTabId === browserTabId);
    if (shared) void unshare(shared[0]);
  });
  chromeApi.tabs.onUpdated.addListener((browserTabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      const shared = Object.entries(state.sharedTabs).find(([, tab]) => tab.browserTabId === browserTabId);
      if (shared) void unshare(shared[0]);
    }
  });
  return { load, pair, shareActiveTab, unshare, revoke, publicState };
}

if (globalThis.chrome?.runtime?.onMessage) {
  const controller = createBackgroundController({ chromeApi: globalThis.chrome, WebSocketImpl: globalThis.WebSocket });
  void controller.load();
  globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handlers = { status: controller.publicState, pair: () => controller.pair(message), share: controller.shareActiveTab, unshare: () => controller.unshare(message.tabId), revoke: controller.revoke };
    const handler = handlers[message?.action];
    if (!handler) return false;
    Promise.resolve(handler()).then((value) => sendResponse({ ok: true, value }), (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
}
