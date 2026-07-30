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
  } else if (state.pairingRequested) {
    dot.className = 'status-dot is-pending';
    text.textContent = 'WebUI での承認を待っています…';
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
    const label = tab.title || tab.origin;
    const item = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = label;
    title.title = label;
    const button = document.createElement('button');
    button.className = 'tab-stop';
    button.textContent = '停止';
    button.setAttribute('aria-label', `「${label}」の共有を停止`);
    button.onclick = () => call('unshare', { tabId: tab.id }).then(render).catch(showError);
    item.append(title, button);
    return item;
  }));
}

export function showError(error) {
  $('status-dot').className = 'status-dot is-error';
  $('status-text').textContent = error.message;
}

function wire() {
  $('apply-broker-url').onclick = () => call('setBrokerUrl', { brokerUrl: $('broker-url').value }).then(render).catch(showError);
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
