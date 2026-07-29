import { createOpaqueRef, isSensitiveControl, sanitizeText } from './snapshot-safety.mjs';

const SELECTOR = 'a,button,input,textarea,select,[role],[contenteditable="true"]';

function attribute(element, name) {
  return typeof element.getAttribute === 'function' ? element.getAttribute(name) ?? '' : '';
}

function accessibleName(element) {
  return sanitizeText(attribute(element, 'aria-label') || attribute(element, 'title') || element.innerText || element.textContent, 256);
}

function roleFor(element) {
  return attribute(element, 'role') || ({ A: 'link', BUTTON: 'button', INPUT: 'input', TEXTAREA: 'textbox', SELECT: 'combobox' }[element.tagName] ?? 'generic');
}

function isVisible(element, windowRef) {
  if (element.hidden || attribute(element, 'aria-hidden') === 'true') return false;
  if (!windowRef?.getComputedStyle || !element.getBoundingClientRect) return true;
  const style = windowRef.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

export function collectSnapshot({ documentRef = document, windowRef = window, snapshotGeneration, maxNodes = 100, maxTextLength = 8_000 } = {}) {
  if (!Number.isSafeInteger(snapshotGeneration) || snapshotGeneration < 1) throw new TypeError('Invalid snapshot generation');
  const nodes = [];
  let totalText = 0;
  let truncated = false;
  for (const element of documentRef.querySelectorAll(SELECTOR)) {
    if (nodes.length >= maxNodes) { truncated = true; break; }
    const control = {
      type: element.type,
      autocomplete: attribute(element, 'autocomplete'),
      name: element.name,
      id: element.id,
      ariaLabel: attribute(element, 'aria-label'),
    };
    if (!isVisible(element, windowRef) || isSensitiveControl(control)) continue;
    const text = sanitizeText(element.innerText || element.textContent, Math.max(0, maxTextLength - totalText));
    totalText += text.length;
    if (totalText >= maxTextLength) truncated = true;
    const node = { ref: createOpaqueRef(snapshotGeneration, nodes.length + 1), role: roleFor(element), name: accessibleName(element) };
    if (text) node.text = text;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) node.hasValue = Boolean(element.value);
    nodes.push(node);
    if (truncated) break;
  }
  return { snapshotGeneration, nodes, truncated };
}
