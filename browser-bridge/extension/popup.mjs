export const $ = (id) => document.getElementById(id);

export async function call(action, extra = {}) {
  const response = await chrome.runtime.sendMessage({ action, ...extra });
  if (!response?.ok) throw new Error(response?.error ?? 'リクエストに失敗しました');
  return response.value;
}

export function render(state) {
  const dot = $('status-dot');
  const text = $('status-text');
  if (state.connected) {
    dot.className = 'status-dot is-connected';
    text.textContent = 'ローカル Broker に接続済み';
  } else if (state.paired) {
    dot.className = 'status-dot is-pending';
    text.textContent = 'ペアリング済み・再接続中…';
  } else {
    dot.className = 'status-dot is-disconnected';
    text.textContent = '未ペアリング';
  }

  $('connect-section').hidden = state.paired;
  $('share').disabled = !state.paired;
  $('auto-share').disabled = !state.paired;
  $('auto-share').checked = Boolean(state.autoShareEnabled);
  $('revoke').disabled = !state.paired;

  const tabs = state.sharedTabs ?? [];
  $('tabs-heading').textContent = `共有中のタブ${tabs.length ? ` (${tabs.length})` : ''}`;
  $('tabs-empty').hidden = tabs.length > 0;
  $('tabs').replaceChildren(...tabs.map((tab) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.textContent = `「${tab.title || tab.origin}」の共有を停止`;
    button.onclick = () => call('unshare', { tabId: tab.id }).then(render).catch(showError);
    item.append(button);
    return item;
  }));
}

export function showError(error) {
  $('status-dot').className = 'status-dot is-error';
  $('status-text').textContent = error.message;
}

function wire() {
  $('pair').onclick = () => call('pair', { brokerUrl: $('broker-url').value, code: $('pairing-code').value }).then(render).catch(showError);
  $('share').onclick = () => call('share').then(render).catch(showError);
  $('auto-share').onchange = (event) => {
    const enabling = event.target.checked;
    call(enabling ? 'enableAutoShare' : 'disableAutoShare').then(render).catch((error) => {
      event.target.checked = !enabling;
      showError(error);
    });
  };
  $('revoke').onclick = () => call('revoke').then(render).catch(showError);
  call('status').then(render).catch(showError);
}

if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) wire();
