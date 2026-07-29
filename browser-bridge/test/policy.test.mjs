import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserBridgeErrorCode } from '../shared/errors.mjs';
import { BrowserToolName } from '../shared/protocol.mjs';
import { classifyElementRisk, evaluateCommandPolicy } from '../broker/policy.mjs';

const sharedTab = { shared: true, origin: 'https://example.com', readAllowed: true, lowRiskAllowed: true };

test('blocks unshared tabs and sensitive fields before an approval can be granted', () => {
  assert.deepEqual(
    evaluateCommandPolicy({ tool: BrowserToolName.SNAPSHOT, tab: { shared: false } }),
    { decision: 'deny', code: BrowserBridgeErrorCode.TAB_NOT_SHARED },
  );
  assert.deepEqual(
    classifyElementRisk({ inputType: 'password' }),
    { risk: 'blocked', reason: 'sensitive_input' },
  );
  assert.deepEqual(
    evaluateCommandPolicy({
      tool: BrowserToolName.TYPE,
      tab: sharedTab,
      element: { autocomplete: 'one-time-code' },
    }),
    { decision: 'deny', code: BrowserBridgeErrorCode.POLICY_BLOCKED },
  );
});

test('allows explicitly permitted reads but requires approval for screenshots and writes', () => {
  assert.deepEqual(
    evaluateCommandPolicy({ tool: BrowserToolName.SNAPSHOT, tab: sharedTab }),
    { decision: 'allow' },
  );
  assert.deepEqual(
    evaluateCommandPolicy({ tool: BrowserToolName.SCREENSHOT, tab: sharedTab }),
    { decision: 'approval' },
  );
  assert.deepEqual(
    evaluateCommandPolicy({ tool: BrowserToolName.TYPE, tab: sharedTab, element: { inputType: 'text' } }),
    { decision: 'approval' },
  );
});

test('requires approval for destructive clicks and cross-origin navigation', () => {
  assert.deepEqual(
    evaluateCommandPolicy({
      tool: BrowserToolName.CLICK,
      tab: sharedTab,
      element: { text: 'Delete account' },
    }),
    { decision: 'approval' },
  );
  assert.deepEqual(
    evaluateCommandPolicy({
      tool: BrowserToolName.NAVIGATE,
      tab: sharedTab,
      targetOrigin: 'https://other.example',
    }),
    { decision: 'approval' },
  );
});
