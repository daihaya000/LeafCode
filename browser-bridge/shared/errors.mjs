/** Stable, public error codes returned by the Broker and MCP adapter. */
export const BrowserBridgeErrorCode = Object.freeze({
  BROKER_UNAVAILABLE: 'BROKER_UNAVAILABLE',
  EXTENSION_DISCONNECTED: 'EXTENSION_DISCONNECTED',
  NOT_PAIRED: 'NOT_PAIRED',
  TAB_NOT_SHARED: 'TAB_NOT_SHARED',
  STALE_REFERENCE: 'STALE_REFERENCE',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  APPROVAL_DENIED: 'APPROVAL_DENIED',
  POLICY_BLOCKED: 'POLICY_BLOCKED',
  COMMAND_TIMEOUT: 'COMMAND_TIMEOUT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INVALID_REQUEST: 'INVALID_REQUEST',
  PROTOCOL_MISMATCH: 'PROTOCOL_MISMATCH',
});

export class BrowserBridgeError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'BrowserBridgeError';
    this.code = code;
  }
}

export function isBrowserBridgeErrorCode(value) {
  return Object.values(BrowserBridgeErrorCode).includes(value);
}
