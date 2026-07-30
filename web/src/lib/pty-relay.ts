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
