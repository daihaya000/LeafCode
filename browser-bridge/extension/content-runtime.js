(() => {
  if (globalThis.__opencodeBrowserBridgeSnapshotInstalled) return;
  globalThis.__opencodeBrowserBridgeSnapshotInstalled = true;
  const sensitive = (el) => el.type === 'password' || /one-time-code|cc-number|cc-csc/i.test(el.autocomplete || '') || /pass(?:word)?|otp|cvv|cvc|card.?number/i.test(`${el.name} ${el.id} ${el.getAttribute('aria-label') || ''}`);
  const clean = (value, max = 512) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  const refs = new Map();
  let activeGeneration = 0;
  new MutationObserver(() => { refs.clear(); activeGeneration = 0; }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'browser_bridge_click') {
      const target = Number.isSafeInteger(message.snapshotGeneration) && message.snapshotGeneration === activeGeneration ? refs.get(message.ref) : undefined;
      if (!target) {
        sendResponse({ ok: false, error: 'STALE_REFERENCE' });
        return false;
      }
      target.click();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === 'browser_bridge_type') {
      const target = Number.isSafeInteger(message.snapshotGeneration) && message.snapshotGeneration === activeGeneration ? refs.get(message.ref) : undefined;
      if (!target) {
        sendResponse({ ok: false, error: 'STALE_REFERENCE' });
        return false;
      }
      if (target.type === 'file' || !['INPUT', 'TEXTAREA'].includes(target.tagName) || typeof message.text !== 'string') {
        sendResponse({ ok: false, error: 'POLICY_BLOCKED' });
        return false;
      }
      target.focus();
      target.value = message.append === true ? `${target.value}${message.text}` : message.text;
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message.text }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === 'browser_bridge_scroll') {
      if (!['up', 'down', 'left', 'right'].includes(message.direction) || !Number.isSafeInteger(message.amount) || message.amount < 1 || message.amount > 2000) {
        sendResponse({ ok: false, error: 'POLICY_BLOCKED' });
        return false;
      }
      const amount = message.direction === 'up' || message.direction === 'left' ? -message.amount : message.amount;
      window.scrollBy({ top: ['up', 'down'].includes(message.direction) ? amount : 0, left: ['left', 'right'].includes(message.direction) ? amount : 0, behavior: 'auto' });
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === 'browser_bridge_navigate') {
      let url;
      try {
        url = new URL(message.url);
      } catch {
        sendResponse({ ok: false, error: 'POLICY_BLOCKED' });
        return false;
      }
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
        sendResponse({ ok: false, error: 'POLICY_BLOCKED' });
        return false;
      }
      refs.clear();
      activeGeneration = 0;
      window.location.assign(url.href);
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type !== 'browser_bridge_collect_snapshot' || !Number.isSafeInteger(message.snapshotGeneration)) return false;
    const nodes = [];
    refs.clear();
    activeGeneration = message.snapshotGeneration;
    let truncated = false;
    let totalText = 0;
    for (const el of document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"]')) {
      if (nodes.length >= 100) { truncated = true; break; }
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (el.hidden || el.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || !rect.width || !rect.height || sensitive(el)) continue;
      const role = el.getAttribute('role') || ({ A: 'link', BUTTON: 'button', INPUT: 'input', TEXTAREA: 'textbox', SELECT: 'combobox' }[el.tagName] || 'generic');
      const node = { ref: `ref_${message.snapshotGeneration}_${nodes.length + 1}`, role, name: clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent, 256) };
      const text = clean(el.innerText || el.textContent, Math.min(512, Math.max(0, 8_000 - totalText)));
      if (text) node.text = text;
      totalText += text.length;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) node.hasValue = Boolean(el.value);
      nodes.push(node);
      refs.set(node.ref, el);
      if (totalText >= 8_000) { truncated = true; break; }
    }
    sendResponse({ snapshotGeneration: message.snapshotGeneration, nodes, truncated });
    return false;
  });
})();
