/**
 * In-process PTY relay registry shared by the stream (SSE output) and input
 * (POST input) routes. Both routes run in the same Node.js server process
 * under the Next.js nodejs runtime, so a module-level Map is a valid shared
 * store. Each entry holds one Engine WebSocket plus the set of SSE listeners
 * forwarding Engine output to the browser.
 *
 * A single PTY gets one Engine WebSocket regardless of how many browser tabs
 * are streaming it: output is fanned out to all listeners, and input from any
 * tab is multiplexed onto the same socket.
 */

export interface PtyRelay {
  ws: WebSocket;
  refcount: number;
  listeners: Set<(data: string) => void>;
  closed: boolean;
}

const relays = new Map<string, PtyRelay>();

/**
 * In-flight connection promises keyed by ptyId. Two concurrent callers that
 * both miss `relays` await the same promise instead of each opening an Engine
 * WebSocket — the second connection would otherwise overwrite the first in
 * `setRelay`, orphaning the first socket (never closed, left for GC).
 */
const connecting = new Map<string, Promise<PtyRelay>>();

/** Accessor for the in-process relay map. */
export function relayRegistry(): Map<string, PtyRelay> {
  return relays;
}

/** Get a live relay for `ptyId`, or undefined when none / already closed. */
export function getRelay(ptyId: string): PtyRelay | undefined {
  const relay = relays.get(ptyId);
  return relay && !relay.closed ? relay : undefined;
}

/** Register a new relay for `ptyId`. Replaces any prior (stale) entry. */
export function setRelay(ptyId: string, relay: PtyRelay): void {
  relays.set(ptyId, relay);
}

/** Drop a relay from the registry (e.g. when its Engine WebSocket closes). */
export function deleteRelay(ptyId: string): void {
  relays.delete(ptyId);
}

/** Decrement refcount; close + remove the relay when it reaches zero. */
export function releaseRelay(ptyId: string): void {
  const relay = relays.get(ptyId);
  if (!relay) return;
  relay.refcount -= 1;
  if (relay.refcount <= 0) {
    relay.closed = true;
    relays.delete(ptyId);
    try { relay.ws.close(); } catch { /* ignore */ }
  }
}

/**
 * Get-or-create the relay for `ptyId`, atomically with respect to concurrent
 * callers. `connect` opens the Engine WebSocket and `attach` wires its
 * message/close listeners; both run exactly once per relay, only for the
 * caller that wins the creation race. Concurrent callers that arrive while a
 * connection is in flight await the same promise and receive the same relay,
 * so a single PTY never gets two Engine WebSockets.
 *
 * On `connect` failure the in-flight slot is cleared so a later call may retry.
 */
export async function acquireRelay(
  ptyId: string,
  connect: () => Promise<WebSocket>,
  attach: (relay: PtyRelay) => void,
): Promise<PtyRelay> {
  const existing = getRelay(ptyId);
  if (existing) return existing;

  const inflight = connecting.get(ptyId);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const ws = await connect();
      // Defensive: if a relay appeared while awaiting (e.g. another code path
      // registered one), discard the redundant socket and reuse the live one.
      const raced = getRelay(ptyId);
      if (raced) {
        try { ws.close(); } catch { /* ignore */ }
        return raced;
      }
      const relay: PtyRelay = { ws, refcount: 0, listeners: new Set(), closed: false };
      setRelay(ptyId, relay);
      attach(relay);
      return relay;
    } finally {
      connecting.delete(ptyId);
    }
  })();

  connecting.set(ptyId, promise);
  return promise;
}
