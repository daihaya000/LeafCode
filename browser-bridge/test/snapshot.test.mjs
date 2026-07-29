import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpaqueRef, isSensitiveControl, sanitizeText } from '../extension/snapshot-safety.mjs';

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
