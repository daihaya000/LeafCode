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
