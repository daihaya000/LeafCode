import { BrowserBridgeError, BrowserBridgeErrorCode } from './errors.mjs';

export const MAX_MESSAGE_BYTES = 256 * 1024;
export const MAX_TEXT_LENGTH = 16_000;
export const MAX_INPUT_LENGTH = 8_000;
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
export const MAX_WAIT_MS = 30_000;

export const BrowserToolName = Object.freeze({
  STATUS: 'browser_status',
  LIST_TABS: 'browser_list_tabs',
  SNAPSHOT: 'browser_snapshot',
  SCREENSHOT: 'browser_screenshot',
  CLICK: 'browser_click',
  TYPE: 'browser_type',
  SCROLL: 'browser_scroll',
  NAVIGATE: 'browser_navigate',
  WAIT: 'browser_wait',
});

const TOOL_NAMES = new Set(Object.values(BrowserToolName));
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1']);

function fail(message) {
  throw new BrowserBridgeError(BrowserBridgeErrorCode.INVALID_REQUEST, message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, allowed) {
  if (!isPlainObject(value)) fail('Expected an object');
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`Unknown field: ${key}`);
  }
}

function assertString(value, field, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    fail(`Invalid ${field}`);
  }
}

function assertOpaqueId(value, field) {
  assertString(value, field, 256);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) fail(`Invalid ${field}`);
}

function assertInteger(value, field, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`Invalid ${field}`);
}

export function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function assertPayloadSize(value, maxBytes = MAX_MESSAGE_BYTES) {
  const bytes = utf8ByteLength(JSON.stringify(value));
  if (bytes > maxBytes) {
    throw new BrowserBridgeError(BrowserBridgeErrorCode.PAYLOAD_TOO_LARGE, 'Payload exceeds limit');
  }
}

export function isAllowedNavigationUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 8_192) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  } catch {
    return false;
  }
}

function assertTabId(args, allowed) {
  assertExactKeys(args, allowed);
  assertOpaqueId(args.tabId, 'tabId');
}

export function validateToolInput(tool, args) {
  if (!TOOL_NAMES.has(tool)) fail('Unknown browser tool');

  switch (tool) {
    case BrowserToolName.STATUS:
      assertExactKeys(args, []);
      break;
    case BrowserToolName.LIST_TABS:
      assertExactKeys(args, []);
      break;
    case BrowserToolName.SNAPSHOT:
    case BrowserToolName.SCREENSHOT:
      assertTabId(args, ['tabId']);
      break;
    case BrowserToolName.CLICK:
      assertTabId(args, ['tabId', 'ref', 'snapshotGeneration']);
      assertOpaqueId(args.ref, 'ref');
      assertInteger(args.snapshotGeneration, 'snapshotGeneration', 1);
      break;
    case BrowserToolName.TYPE:
      assertTabId(args, ['tabId', 'ref', 'snapshotGeneration', 'text', 'append']);
      assertOpaqueId(args.ref, 'ref');
      assertInteger(args.snapshotGeneration, 'snapshotGeneration', 1);
      assertString(args.text, 'text', MAX_INPUT_LENGTH);
      if (args.append !== undefined && typeof args.append !== 'boolean') fail('Invalid append');
      break;
    case BrowserToolName.SCROLL:
      assertTabId(args, ['tabId', 'direction', 'amount']);
      if (!['up', 'down', 'left', 'right'].includes(args.direction)) fail('Invalid direction');
      assertInteger(args.amount, 'amount', 1, 2_000);
      break;
    case BrowserToolName.NAVIGATE:
      assertTabId(args, ['tabId', 'url']);
      if (!isAllowedNavigationUrl(args.url)) fail('URL scheme or host is not allowed');
      break;
    case BrowserToolName.WAIT:
      assertTabId(args, ['tabId', 'timeoutMs']);
      assertInteger(args.timeoutMs, 'timeoutMs', 1, MAX_WAIT_MS);
      break;
    default:
      fail('Unknown browser tool');
  }

  assertPayloadSize(args);
  return Object.freeze({ ...args });
}
