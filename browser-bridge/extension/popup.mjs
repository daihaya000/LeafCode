const $ = (id) => document.getElementById(id);
async function call(action, extra = {}) { const response = await chrome.runtime.sendMessage({ action, ...extra }); if (!response?.ok) throw new Error(response?.error ?? 'Request failed'); return response.value; }
function render(state) { $('status').textContent = state.connected ? 'Connected to local Broker' : state.paired ? 'Paired; reconnecting…' : 'Not paired'; $('share').disabled = !state.paired; $('auto-share').disabled = !state.paired; $('auto-share').checked = Boolean(state.autoShareEnabled); $('tabs').replaceChildren(...state.sharedTabs.map((tab) => { const item = document.createElement('li'); const button = document.createElement('button'); button.textContent = `Stop sharing ${tab.title || tab.origin}`; button.onclick = () => call('unshare', { tabId: tab.id }).then(render).catch(showError); item.append(button); return item; })); }
function showError(error) { $('status').textContent = error.message; }
$('pair').onclick = () => call('pair', { brokerUrl: $('broker-url').value, code: $('pairing-code').value }).then(render).catch(showError);
$('share').onclick = () => call('share').then(render).catch(showError);
$('auto-share').onchange = (event) => { const enabling = event.target.checked; call(enabling ? 'enableAutoShare' : 'disableAutoShare').then(render).catch((error) => { event.target.checked = !enabling; showError(error); }); };
$('revoke').onclick = () => call('revoke').then(render).catch(showError);
call('status').then(render).catch(showError);
