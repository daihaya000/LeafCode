/** SSE / nested-poll health helpers (pure, unit-tested). */

/** How often the BFF should emit a named heartbeat on long-lived SSE. */
export const SSE_HEARTBEAT_MS = 15_000;

/**
 * If the client sees no SSE activity (message or heartbeat) for this long
 * while "live", treat the connection as silently dead and force reconnect.
 * Must be > 2× heartbeat so one missed ping is not enough.
 */
export const SSE_SILENCE_MS = 45_000;

/** NestedAgentPanel / similar polls should abort hung GETs. */
export const NESTED_POLL_TIMEOUT_MS = 15_000;

/**
 * How long the BFF waits for the *response headers* of an upstream SSE
 * subscription (`/event`, `/global/event`) before giving up.
 *
 * A saturated OpenCode engine can take tens of seconds — sometimes minutes — to
 * start the stream. Without this bound the BFF holds the request open for the
 * route's whole `maxDuration`, so the browser's EventSource stays in CONNECTING
 * and never fires `error`: the WebUI reads as permanently "reconnecting" with no
 * recovery path. Returning a fast error instead lets the client retry with
 * backoff and releases the upstream connection.
 *
 * Only the wait for headers is bounded; an established stream is never timed out.
 */
export const SSE_UPSTREAM_CONNECT_TIMEOUT_MS = 20_000;

/**
 * Client-side guard for an EventSource stuck in CONNECTING.
 * Kept above `SSE_UPSTREAM_CONNECT_TIMEOUT_MS` so the BFF's own error response
 * stays the normal recovery path and this only catches a wedged connection
 * (direct :3000 access, a hung proxy hop, a suspended tab).
 */
export const SSE_CONNECT_STALL_MS = 45_000;

/** True when a connect attempt started at `connectStartedAt` has stalled. */
export function isSseConnectStalled(
  connectStartedAt: number,
  now: number,
  thresholdMs: number = SSE_CONNECT_STALL_MS,
): boolean {
  return now - connectStartedAt >= thresholdMs;
}

export function isSseSilent(
  lastActivityAt: number,
  now: number,
  thresholdMs: number = SSE_SILENCE_MS,
): boolean {
  return now - lastActivityAt >= thresholdMs;
}

/** Named event so EventSource.addEventListener("heartbeat") fires (comments do not). */
export function encodeSseHeartbeat(): string {
  return "event: heartbeat\ndata: {}\n\n";
}

export function shouldPollWhileVisible(
  visibilityState: Document["visibilityState"] | string,
): boolean {
  return visibilityState === "visible";
}
