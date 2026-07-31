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

/**
 * What a relay pushes to its SSE listeners.
 *
 * A discriminated union rather than a bare string: PTY output can legitimately
 * be an empty string, so an empty-string "socket closed" sentinel would be
 * ambiguous.
 *
 * `close` carries the WebSocket close code so the stream route can
 * distinguish a permanent PTY exit (Engine code 4404) from a transient
 * network drop — the former should stop the browser's reconnect backoff,
 * the latter should let it retry.
 */
export type PtyRelayEvent =
  | { type: "data"; data: string }
  | { type: "close"; code?: number };

export interface PtyRelay {
  ws: WebSocket;
  refcount: number;
  listeners: Set<(event: PtyRelayEvent) => void>;
  closed: boolean;
}

const relays = new Map<string, PtyRelay>();

/**
 * First byte of an Engine *meta* frame (`0x00` followed by JSON such as
 * `{"cursor":12}`). Meta frames carry replay bookkeeping, not terminal output,
 * and must never be written to xterm — otherwise the raw JSON shows up in the
 * terminal.
 */
const PTY_META_FRAME_PREFIX = 0x00;

/**
 * Decode one Engine WebSocket frame into terminal output text.
 *
 * Returns `null` for meta frames and for frame types that carry no output, so
 * callers can skip them. `decoder` must be reused across calls for a given
 * relay: PTY output is chunked arbitrarily and a multi-byte UTF-8 sequence can
 * straddle two frames, which `{ stream: true }` buffers correctly.
 */
export function decodePtyFrame(
  data: unknown,
  decoder: TextDecoder,
): string | null {
  if (typeof data === "string") {
    return data.charCodeAt(0) === PTY_META_FRAME_PREFIX ? null : data;
  }

  // Realm-safe buffer detection. `instanceof ArrayBuffer` returns false when
  // the buffer was created in another realm (Node's WebSocket vs. the route's
  // globals), which would silently drop every output frame. `isView` and the
  // internal-slot brand check are both realm-independent.
  let bytes: Uint8Array | null = null;
  if (ArrayBuffer.isView(data)) {
    bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
    const tag = Object.prototype.toString.call(data);
    if (tag === "[object ArrayBuffer]" || tag === "[object SharedArrayBuffer]") {
      bytes = new Uint8Array(data as ArrayBuffer);
    }
  }
  if (!bytes) return null;
  if (bytes.length === 0) return null;
  if (bytes[0] === PTY_META_FRAME_PREFIX) return null;

  return decoder.decode(bytes, { stream: true });
}

/**
 * In-flight connection promises keyed by ptyId. Two concurrent callers that
 * both miss `relays` await the same promise instead of each opening an Engine
 * WebSocket — the second connection would otherwise overwrite the first in
 * `setRelay`, orphaning the first socket (never closed, left for GC).
 */
const connecting = new Map<string, Promise<PtyRelay>>();

// ---------------------------------------------------------------------------
// Cursor cache — survives relay teardown so a reconnecting stream can pass
// `?cursor=N` to the Engine WS and replay any output produced during the
// disconnect gap. Without this, a transient network drop silently loses
// whatever the PTY printed between the drop and the reconnect.
// ---------------------------------------------------------------------------
const cursors = new Map<string, number>();

/** Store the last cursor position for a PTY (for replay on reconnect). */
export function setCursor(ptyId: string, cursor: number): void {
  cursors.set(ptyId, cursor);
}

/** Retrieve the cached cursor for replay, or `undefined` if none. */
export function getCursor(ptyId: string): number | undefined {
  return cursors.get(ptyId);
}

/** Clear the cached cursor (e.g. when the PTY is deleted or exits). */
export function clearCursor(ptyId: string): void {
  cursors.delete(ptyId);
}

/**
 * Extract the cursor from an Engine meta frame (`0x00` + JSON such as
 * `{"cursor":12}`). Returns `undefined` for non-meta frames or malformed
 * payloads. Used by the stream route to keep the cursor cache fresh so a
 * later reconnect replays from the right position.
 */
export function parseMetaCursor(data: unknown): number | undefined {
  if (typeof data === "string") {
    if (data.charCodeAt(0) !== PTY_META_FRAME_PREFIX) return undefined;
    try {
      const json = JSON.parse(data.slice(1)) as { cursor?: unknown };
      return typeof json.cursor === "number" ? json.cursor : undefined;
    } catch { return undefined; }
  }

  let bytes: Uint8Array | null = null;
  if (ArrayBuffer.isView(data)) {
    bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
    const tag = Object.prototype.toString.call(data);
    if (tag === "[object ArrayBuffer]" || tag === "[object SharedArrayBuffer]") {
      bytes = new Uint8Array(data as ArrayBuffer);
    }
  }
  if (!bytes || bytes.length === 0 || bytes[0] !== PTY_META_FRAME_PREFIX) {
    return undefined;
  }
  try {
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as {
      cursor?: unknown;
    };
    return typeof json.cursor === "number" ? json.cursor : undefined;
  } catch { return undefined; }
}

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
    // Keep the cursor: the browser may reopen the stream shortly, and the
    // cached cursor lets the new relay replay from the right position.
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
