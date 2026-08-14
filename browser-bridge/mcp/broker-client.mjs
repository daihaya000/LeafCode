import { BrowserBridgeError, BrowserBridgeErrorCode, isBrowserBridgeErrorCode } from '../shared/errors.mjs';
import { validateToolInput } from '../shared/schemas.mjs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1']);

function normalizeBrokerUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BrowserBridgeError(BrowserBridgeErrorCode.BROKER_UNAVAILABLE, 'Browser Bridge Broker URL is required');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new BrowserBridgeError(BrowserBridgeErrorCode.BROKER_UNAVAILABLE, 'Browser Bridge Broker URL is invalid');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new BrowserBridgeError(BrowserBridgeErrorCode.BROKER_UNAVAILABLE, 'Browser Bridge Broker must use a loopback URL');
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function readBrokerEnvironment(env = process.env) {
  const token = env.LEAFCODE_BROWSER_BROKER_TOKEN;
  if (typeof token !== 'string' || token.length < 32) {
    throw new BrowserBridgeError(BrowserBridgeErrorCode.BROKER_UNAVAILABLE, 'Browser Bridge Broker credential is required');
  }
  return {
    baseUrl: normalizeBrokerUrl(env.LEAFCODE_BROWSER_BROKER),
    token,
  };
}

export class BrowserBridgeClient {
  #baseUrl;
  #token;
  #fetch;
  #timeoutMs;

  constructor({ baseUrl, token, fetchImpl = fetch, timeoutMs = 35_000 }) {
    this.#baseUrl = normalizeBrokerUrl(baseUrl);
    if (typeof token !== 'string' || token.length < 32) {
      throw new BrowserBridgeError(BrowserBridgeErrorCode.BROKER_UNAVAILABLE, 'Browser Bridge Broker credential is required');
    }
    if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new TypeError('Invalid Broker client configuration');
    }
    this.#token = token;
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  static fromEnvironment(env = process.env, options = {}) {
    return new BrowserBridgeClient({ ...readBrokerEnvironment(env), ...options });
  }

  async call(tool, args) {
    const input = validateToolInput(tool, args);
    try {
      const response = await this.#fetch(`${this.#baseUrl}/internal/tools/${encodeURIComponent(tool)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
        cache: 'no-store',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const code = body?.error?.code;
        if (isBrowserBridgeErrorCode(code)) throw new BrowserBridgeError(code);
        throw new BrowserBridgeError(BrowserBridgeErrorCode.BROKER_UNAVAILABLE);
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new BrowserBridgeError(BrowserBridgeErrorCode.BROKER_UNAVAILABLE);
      }
      return body;
    } catch (error) {
      if (error instanceof BrowserBridgeError) throw error;
      throw new BrowserBridgeError(BrowserBridgeErrorCode.BROKER_UNAVAILABLE);
    }
  }
}
