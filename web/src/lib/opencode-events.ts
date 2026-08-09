/**
 * Registry of the OpenCode SSE event types the WebUI actually reacts to.
 *
 * Why this exists
 * ---------------
 * The event stream carries two generations at once (see `opencode-paths.ts`):
 *
 * - the original flat events (`message.part.updated`, `session.status`,
 *   `permission.asked`, ...), and
 * - the v2 "session next" events (`session.next.text.delta`,
 *   `session.next.tool.called`, ...) plus the `*.v2.*` permission/question
 *   variants.
 *
 * `useSessionStream.ts` handles both through a long chain of string
 * comparisons. Those literals were previously invisible to any check: if the
 * engine renamed `session.next.tool.input.delta`, the branch simply stopped
 * firing and streaming tool input silently disappeared from the UI  Eno build
 * error, no failing test, just a behaviour regression noticed by a user.
 *
 * Declaring them here gives the accompanying test something to verify against
 * the generated OpenAPI schema after every `npm run gen:types`. The test only
 * asserts "everything we handle still exists upstream"; brand-new engine events
 * we do not consume yet are intentionally not flagged, otherwise every engine
 * release would fail the build for events we deliberately ignore.
 */

/** Events from the original (v1) engine surface. */
export const HANDLED_V1_EVENT_TYPES = [
  "message.updated",
  "message.removed",
  "message.part.updated",
  "message.part.removed",
  "session.status",
  "session.idle",
  "session.compacted",
  "session.error",
  "todo.updated",
  "permission.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
  "question.rejected",
] as const;

/**
 * Events from the v2 (beta) surface that the WebUI already consumes.
 *
 * `permission.v2.*` / `question.v2.*` are the session-scoped approval events
 * that pair with the `/api/session/{id}/permission|question/...` REST paths;
 * `session.next.*` is the fine-grained streaming protocol that replaces
 * whole-part `message.part.updated` snapshots with deltas.
 */
export const HANDLED_V2_EVENT_TYPES = [
  "permission.v2.asked",
  "permission.v2.replied",
  "question.v2.asked",
  "question.v2.replied",
  "question.v2.rejected",
  "session.next.text.started",
  "session.next.text.delta",
  "session.next.text.ended",
  "session.next.reasoning.started",
  "session.next.reasoning.delta",
  "session.next.reasoning.ended",
  "session.next.tool.input.started",
  "session.next.tool.input.delta",
  "session.next.tool.input.ended",
  "session.next.tool.called",
  "session.next.tool.success",
  "session.next.tool.failed",
  "session.next.step.ended",
  "session.next.step.failed",
] as const;

export type HandledV1EventType = (typeof HANDLED_V1_EVENT_TYPES)[number];
export type HandledV2EventType = (typeof HANDLED_V2_EVENT_TYPES)[number];
export type HandledEventType = HandledV1EventType | HandledV2EventType;

export const HANDLED_EVENT_TYPES: readonly HandledEventType[] = [
  ...HANDLED_V1_EVENT_TYPES,
  ...HANDLED_V2_EVENT_TYPES,
];

/** Prefix shared by every v2 streaming event. */
export const SESSION_NEXT_EVENT_PREFIX = "session.next.";

/** True for any `session.next.*` event, handled or not. */
export function isSessionNextEvent(type: string): boolean {
  return type.startsWith(SESSION_NEXT_EVENT_PREFIX);
}

/**
 * Which API generation an event belongs to, or `null` when the WebUI does not
 * consume it. Used by the drift test and available to callers that need to
 * branch on generation rather than on each individual type.
 */
export function eventGeneration(type: string): "v1" | "v2" | null {
  if ((HANDLED_V1_EVENT_TYPES as readonly string[]).includes(type)) return "v1";
  if ((HANDLED_V2_EVENT_TYPES as readonly string[]).includes(type)) return "v2";
  return null;
}

/**
 * Permission/question events that mean "this request is no longer pending",
 * across both generations. Kept here so the attention queue and the session
 * stream cannot drift apart on which events clear a card.
 */
export const RESOLVED_REQUEST_EVENT_TYPES = [
  "permission.replied",
  "permission.v2.replied",
  "question.replied",
  "question.rejected",
  "question.v2.replied",
  "question.v2.rejected",
] as const satisfies readonly HandledEventType[];

export function isResolvedRequestEventType(type: string): boolean {
  return (RESOLVED_REQUEST_EVENT_TYPES as readonly string[]).includes(type);
}
