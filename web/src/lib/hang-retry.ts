import type { MessageWithParts } from "./types";

/**
 * Metadata written to the prompt the hang watchdog re-sends, so the UI can hide
 * the duplicated copy and still report that an automatic resume happened.
 *
 * This module is deliberately free of React/browser imports: the server-side
 * watchdog (`hang-watchdog.ts`) marks resume bodies with the exact same key the
 * client renderer filters on.
 */
export const HANG_RETRY_METADATA_KEY = "webui_hang_retry";

/** Clone a prompt body and mark its text parts as an automatic hang retry. */
export function markHangRetryBody(body: Record<string, unknown>): Record<string, unknown> {
  const parts = body.parts;
  if (!Array.isArray(parts)) return body;
  return {
    ...body,
    parts: parts.map((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) return part;
      const value = part as Record<string, unknown>;
      if (value.type !== "text") return part;
      const metadata =
        value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
          ? value.metadata
          : {};
      return {
        ...value,
        metadata: { ...metadata, [HANG_RETRY_METADATA_KEY]: true },
      };
    }),
  };
}

/**
 * True when a raw request body already carries the hang-retry marker. The BFF
 * proxy uses this so a resumed prompt cannot hand the session a fresh retry
 * budget.
 */
export function hasHangRetryMarker(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const parts = (body as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return false;
  return parts.some((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return false;
    const metadata = (part as Record<string, unknown>).metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
    return (metadata as Record<string, unknown>)[HANG_RETRY_METADATA_KEY] === true;
  });
}

/** True for the synthetic user message the watchdog created when it resumed. */
export function isHangRetryUserMessage(message: MessageWithParts): boolean {
  if (message.info.role !== "user") return false;
  return message.parts.some(
    (part) => part.type === "text" && part.metadata?.[HANG_RETRY_METADATA_KEY] === true,
  );
}

/** How many times this session was automatically resumed after a hang. */
export function countHangRetryUserMessages(messages: MessageWithParts[]): number {
  let count = 0;
  for (const message of messages) {
    if (isHangRetryUserMessage(message)) count += 1;
  }
  return count;
}
