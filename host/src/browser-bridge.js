/**
 * Browser Bridge pairing storage and broker lifecycle for the host process
 * (REFACTORING_PLAN P6-a / IMPROVEMENT 4-1: Browser Bridge Broker group).
 */
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { createBrowserBridgeBroker } from '../../browser-bridge/broker/server.mjs';

/**
 * @param {{
 *   pairingFile: string,
 *   port: number,
 *   ensureDataDir?: () => void,
 *   log?: (message: string) => void,
 *   error?: (message: string) => void,
 *   WebSocketServer: typeof import('ws').WebSocketServer,
 *   createBroker?: typeof createBrowserBridgeBroker,
 * }} deps
 */
export function createBrowserBridgeManager(deps) {
  const pairingFile = deps.pairingFile;
  const port = deps.port;
  const ensureDataDir = deps.ensureDataDir ?? (() => {});
  const log = deps.log ?? (() => {});
  const error = deps.error ?? (() => {});
  const { WebSocketServer } = deps;
  const createBroker = deps.createBroker ?? createBrowserBridgeBroker;

  /** @type {import('../../browser-bridge/broker/server.mjs').BrowserBridgeBroker | null} */
  let broker = null;

  const environment = () => {
    if (!broker) return {};
    return {
      LEAFCODE_BROWSER_BROKER: broker.url,
      LEAFCODE_BROWSER_BROKER_TOKEN: broker.internalToken,
      // Legacy names: existing opencode.json MCP entries reference
      // {env:OPENCODE_WEBUI_BROWSER_BROKER}; keep both alive during the
      // rebrand so those configs keep resolving.
      OPENCODE_WEBUI_BROWSER_BROKER: broker.url,
      OPENCODE_WEBUI_BROWSER_BROKER_TOKEN: broker.internalToken,
    };
  };

  const loadPairing = () => {
    if (!existsSync(pairingFile)) return null;
    try {
      const value = JSON.parse(readFileSync(pairingFile, 'utf8'));
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof value.origin === 'string' &&
        /^chrome-extension:\/\/[a-z]{16,64}$/.test(value.origin) &&
        typeof value.deviceKey === 'string' &&
        /^[A-Za-z0-9_-]{20,}$/.test(value.deviceKey)
      ) {
        return { origin: value.origin, deviceKey: value.deviceKey };
      }
    } catch {
      // Invalid pairing file — drop it below.
    }
    try {
      unlinkSync(pairingFile);
    } catch {
      // best effort
    }
    return null;
  };

  const savePairing = (value) => {
    ensureDataDir();
    if (!value) {
      try {
        unlinkSync(pairingFile);
      } catch {
        // best effort
      }
      return;
    }
    writeFileSync(pairingFile, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  };

  const start = async () => {
    if (broker) return;
    const next = createBroker({
      internalToken: randomBytes(32).toString('base64url'),
      WebSocketServer,
      persistedPairing: loadPairing(),
      onPairingChanged: (value) => {
        try {
          savePairing(value);
        } catch (err) {
          error(
            `Browser Bridge pairing state was not saved: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    });
    await next.listen(port);
    broker = next;
    log(`Browser Bridge Broker listening on ${broker.url}`);
  };

  const close = async () => {
    if (!broker) return;
    const current = broker;
    broker = null;
    await current.close();
  };

  return { environment, loadPairing, savePairing, start, close };
}
