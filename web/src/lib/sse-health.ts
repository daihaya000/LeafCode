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
