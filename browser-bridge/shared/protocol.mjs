import { BrowserBridgeError, BrowserBridgeErrorCode, isBrowserBridgeErrorCode } from './errors.mjs';
import { BrowserToolName, MAX_MESSAGE_BYTES, assertPayloadSize, validateToolInput } from './schemas.mjs';

export const PROTOCOL_VERSION = 1;

export const CommandState = Object.freeze({
  QUEUED: 'queued',
  AWAITING_APPROVAL: 'awaiting_approval',
  DISPATCHED: 'dispatched',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const COMMAND_STATES = new Set(Object.values(CommandState));
const TERMINAL_STATES = new Set([
  CommandState.SUCCEEDED,
  CommandState.FAILED,
  CommandState.CANCELLED,
]);

function fail(message, code = BrowserBridgeErrorCode.INVALID_REQUEST) {
  throw new BrowserBridgeError(code, message);
}

function assertExactKeys(value, allowed) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('Expected an object');
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`Unknown field: ${key}`);
  }
}

function assertOpaqueId(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) fail(`Invalid ${field}`);
}

function assertGeneration(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`Invalid ${field}`);
}

export function isTerminalCommandState(state) {
  return TERMINAL_STATES.has(state);
}

/** Validates a Broker-to-extension command. */
export function validateCommandEnvelope(value) {
  assertExactKeys(value, [
    'protocolVersion',
    'type',
    'commandId',
    'connectionGeneration',
    'snapshotGeneration',
    'tool',
    'args',
  ]);
  if (value.protocolVersion !== PROTOCOL_VERSION) fail('Unsupported protocol version', BrowserBridgeErrorCode.PROTOCOL_MISMATCH);
  if (value.type !== 'command') fail('Invalid envelope type');
  assertOpaqueId(value.commandId, 'commandId');
  assertGeneration(value.connectionGeneration, 'connectionGeneration');
  if (value.snapshotGeneration !== undefined) assertGeneration(value.snapshotGeneration, 'snapshotGeneration');
  const args = validateToolInput(value.tool, value.args);
  assertPayloadSize(value, MAX_MESSAGE_BYTES);
  return Object.freeze({ ...value, args });
}

/** Validates an extension-to-Broker result for a previously dispatched command. */
export function validateResultEnvelope(value) {
  assertExactKeys(value, [
    'protocolVersion',
    'type',
    'commandId',
    'connectionGeneration',
    'state',
    'result',
    'error',
  ]);
  if (value.protocolVersion !== PROTOCOL_VERSION) fail('Unsupported protocol version', BrowserBridgeErrorCode.PROTOCOL_MISMATCH);
  if (value.type !== 'result') fail('Invalid envelope type');
  assertOpaqueId(value.commandId, 'commandId');
  assertGeneration(value.connectionGeneration, 'connectionGeneration');
  if (!COMMAND_STATES.has(value.state) || !isTerminalCommandState(value.state)) {
    fail('Result must have a terminal state');
  }
  if (value.state === CommandState.SUCCEEDED) {
    if (value.error !== undefined) fail('Successful result cannot include an error');
  } else {
    assertExactKeys(value.error, ['code', 'message']);
    if (!isBrowserBridgeErrorCode(value.error.code) || typeof value.error.message !== 'string') {
      fail('Invalid error');
    }
  }
  assertPayloadSize(value, MAX_MESSAGE_BYTES);
  return Object.freeze({ ...value });
}

export function createCommandEnvelope({ commandId, connectionGeneration, snapshotGeneration, tool, args }) {
  return validateCommandEnvelope({
    protocolVersion: PROTOCOL_VERSION,
    type: 'command',
    commandId,
    connectionGeneration,
    ...(snapshotGeneration === undefined ? {} : { snapshotGeneration }),
    tool,
    args,
  });
}

export { BrowserToolName };
