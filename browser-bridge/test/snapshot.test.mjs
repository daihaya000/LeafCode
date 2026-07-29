import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpaqueRef, isSensitiveControl, sanitizeText } from '../extension/snapshot-safety.mjs';
import { collectSnapshot } from '../extension/content.js';

test('snapshot safety excludes password, OTP, and card controls before DOM values are read', () => {
  assert.equal(isSensitiveControl({ type: 'password' }), true);
  assert.equal(isSensitiveControl({ autocomplete: 'one-time-code' }), true);
  assert.equal(isSensitiveControl({ name: 'cardNumber' }), true);
  assert.equal(isSensitiveControl({ ariaLabel: 'Search documentation' }), false);
});

test('snapshot text is normalized and bounded, and references contain no selector data', () => {
  assert.equal(sanitizeText('  hello\n\tworld  '), 'hello world');
  assert.equal(sanitizeText('x'.repeat(9), 8), 'x'.repeat(8));
  assert.equal(createOpaqueRef(2, 7), 'ref_2_7');
  assert.throws(() => createOpaqueRef(0, 1), /Invalid snapshot reference/);
});

test('collects visible actionable nodes without values or sensitive fields', () => {
  const visible = (tagName, props = {}) => ({ tagName, hidden: false, type: '', name: '', id: '', value: '', innerText: '', textContent: '', getAttribute: () => '', getBoundingClientRect: () => ({ width: 10, height: 10 }), ...props });
  const nodes = [
    visible('BUTTON', { innerText: ' Save changes ' }),
    visible('INPUT', { type: 'password', value: 'do-not-read', name: 'password' }),
    visible('INPUT', { value: 'query', getAttribute: (name) => name === 'aria-label' ? 'Search' : '' }),
  ];
  const snapshot = collectSnapshot({ documentRef: { querySelectorAll: () => nodes }, windowRef: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) }, snapshotGeneration: 4 });
  assert.deepEqual(snapshot.nodes, [
    { ref: 'ref_4_1', role: 'button', name: 'Save changes', text: 'Save changes' },
    { ref: 'ref_4_2', role: 'input', name: 'Search', hasValue: true },
  ]);
  assert.equal(JSON.stringify(snapshot).includes('do-not-read'), false);
});

test('marks a snapshot as truncated when its aggregate text budget is exhausted', () => {
  const element = (text) => ({ tagName: 'BUTTON', hidden: false, innerText: text, textContent: text, getAttribute: () => '', getBoundingClientRect: () => ({ width: 10, height: 10 }) });
  const snapshot = collectSnapshot({ documentRef: { querySelectorAll: () => [element('abcdef'), element('later')] }, windowRef: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) }, snapshotGeneration: 1, maxTextLength: 3 });
  assert.equal(snapshot.truncated, true);
  assert.deepEqual(snapshot.nodes, [{ ref: 'ref_1_1', role: 'button', name: 'abcdef', text: 'abc' }]);
});
