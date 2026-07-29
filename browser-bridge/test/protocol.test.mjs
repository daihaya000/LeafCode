import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserBridgeErrorCode } from '../shared/errors.mjs';
import {
  BrowserToolName,
  CommandState,
  PROTOCOL_VERSION,
  createCommandEnvelope,
  isTerminalCommandState,
  validateResultEnvelope,
} from '../shared/protocol.mjs';
import { MAX_INPUT_LENGTH, MAX_MESSAGE_BYTES, isAllowedNavigationUrl, validateToolInput } from '../shared/schemas.mjs';

function expectCode(callback, code) {
  assert.throws(callback, (error) => error?.code === code);
}

test('creates a versioned command envelope with required generations', () => {
  const command = createCommandEnvelope({
    commandId: 'cmd_1',
    connectionGeneration: 2,
    snapshotGeneration: 3,
    tool: BrowserToolName.CLICK,
    args: { tabId: 'tab_1', ref: 'ref_1', snapshotGeneration: 3 },
  });
  assert.equal(command.protocolVersion, PROTOCOL_VERSION);
  assert.equal(command.type, 'command');
  assert.equal(command.connectionGeneration, 2);
  assert.equal(command.snapshotGeneration, 3);
  assert.deepEqual(command.args, { tabId: 'tab_1', ref: 'ref_1', snapshotGeneration: 3 });
});

test('rejects missing and unknown tool input fields', () => {
  expectCode(
    () => validateToolInput(BrowserToolName.CLICK, { tabId: 'tab_1', ref: 'ref_1' }),
    BrowserBridgeErrorCode.INVALID_REQUEST,
  );
  expectCode(
    () => validateToolInput(BrowserToolName.SNAPSHOT, { tabId: 'tab_1', selector: 'body' }),
    BrowserBridgeErrorCode.INVALID_REQUEST,
  );
});

test('only allows HTTPS and loopback HTTP navigation', () => {
  assert.equal(isAllowedNavigationUrl('https://example.com/path'), true);
  assert.equal(isAllowedNavigationUrl('http://localhost:3000/path'), true);
  assert.equal(isAllowedNavigationUrl('http://127.0.0.1:3000/path'), true);
  assert.equal(isAllowedNavigationUrl('http://example.com/path'), false);
  assert.equal(isAllowedNavigationUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedNavigationUrl('file:///secret.txt'), false);
});

test('enforces text and payload byte limits', () => {
  expectCode(
    () => validateToolInput(BrowserToolName.TYPE, {
      tabId: 'tab_1',
      ref: 'ref_1',
      snapshotGeneration: 1,
      text: 'x'.repeat(MAX_INPUT_LENGTH + 1),
    }),
    BrowserBridgeErrorCode.INVALID_REQUEST,
  );
  expectCode(
    () => validateToolInput(BrowserToolName.STATUS, { padding: 'x'.repeat(MAX_MESSAGE_BYTES) }),
    BrowserBridgeErrorCode.INVALID_REQUEST,
  );
  expectCode(
    () => validateResultEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      type: 'result',
      commandId: 'cmd_1',
      connectionGeneration: 1,
      state: CommandState.SUCCEEDED,
      result: 'x'.repeat(MAX_MESSAGE_BYTES),
    }),
    BrowserBridgeErrorCode.PAYLOAD_TOO_LARGE,
  );
});

test('accepts only terminal result states and validates error codes', () => {
  assert.equal(isTerminalCommandState(CommandState.SUCCEEDED), true);
  assert.equal(isTerminalCommandState(CommandState.DISPATCHED), false);
  const result = validateResultEnvelope({
    protocolVersion: PROTOCOL_VERSION,
    type: 'result',
    commandId: 'cmd_1',
    connectionGeneration: 1,
    state: CommandState.FAILED,
    error: { code: BrowserBridgeErrorCode.POLICY_BLOCKED, message: 'blocked' },
  });
  assert.equal(result.error.code, BrowserBridgeErrorCode.POLICY_BLOCKED);
  expectCode(
    () => validateResultEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      type: 'result',
      commandId: 'cmd_1',
      connectionGeneration: 1,
      state: CommandState.DISPATCHED,
    }),
    BrowserBridgeErrorCode.INVALID_REQUEST,
  );
});
