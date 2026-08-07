/**
 * Single registry for every OpenCode engine REST path the WebUI calls.
 *
 * Why this exists
 * ---------------
 * The engine currently exposes two API generations side by side:
 *
 * - **v1** — the original flat surface (`/session`, `/session/{id}/message`,
 *   `/permission/{id}/reply`, ...). Every core operation still runs on this.
 * - **v2 (beta)** — the `/api/*` surface (`/api/session/{id}/prompt`,
 *   `/api/session/{id}/permission/{requestID}/reply`, ...). The WebUI already
 *   uses a few of these (session-scoped permission/question replies) and the
 *   SSE stream already carries `session.next.*` events from the same
 *   generation, so the runtime is a **hybrid**, not "v1 only".
 *
 * When v2 goes GA the v1 paths will be removed. Before this module the path
 * strings were interpolated inline across ~10 files, so a migration meant
 * grepping for `"/session"` and hoping nothing was missed, and a breaking
 * rename in the engine would only surface as a 404 at runtime.
 *
 * Two guarantees this module adds:
 *
 * 1. **One place to change.** Callers ask for `sessionPromptAsyncPath(id)`
 *    instead of building `` `/session/${id}/prompt_async` ``, so switching a
 *    call to its v2 equivalent is a one-line edit here.
 * 2. **Compile-time drift detection.** {@link OC_PATH_TEMPLATES} is declared
 *    `satisfies Record<string, keyof OcPaths>` against the generated OpenAPI
 *    types. Re-running `npm run gen:types` after an engine upgrade turns any
 *    removed/renamed endpoint into a `tsc` error naming the exact template,
 *    instead of a runtime 404 discovered by a user.
 *
 * Ids are routed through {@link openCodeSessionPath} (or {@link encodePathId})
 * so they are validated and percent-encoded exactly once, matching the
 * traversal defence in `opencode-id.ts`.
 */

import type { OcPaths } from "./opencode-api";
import { openCodeSessionPath, assertSafeOpenCodeSessionId } from "./opencode-id";

/**
 * Every engine endpoint template the WebUI depends on, keyed by a stable
 * internal name. The `satisfies` clause is the drift detector: each value must
 * still be a key of the generated `paths` interface.
 *
 * Adding an entry here without regenerating types, or regenerating types after
 * the engine drops an endpoint, both fail the build.
 */
export const OC_PATH_TEMPLATES = {
  // --- v1: sessions -------------------------------------------------------
  sessionList: "/session",
  sessionStatus: "/session/status",
  session: "/session/{sessionID}",
  sessionMessage: "/session/{sessionID}/message",
  sessionTodo: "/session/{sessionID}/todo",
  sessionDiff: "/session/{sessionID}/diff",
  sessionAbort: "/session/{sessionID}/abort",
  sessionPromptAsync: "/session/{sessionID}/prompt_async",
  sessionCommand: "/session/{sessionID}/command",
  sessionPermissionReply: "/session/{sessionID}/permissions/{permissionID}",

  // --- v1: global permission / question queues ----------------------------
  permissionList: "/permission",
  questionList: "/question",
  questionReply: "/question/{requestID}/reply",
  questionReject: "/question/{requestID}/reject",

  // --- v1: misc -----------------------------------------------------------
  event: "/event",

  // --- v2 (beta): session-scoped permission / question --------------------
  v2SessionPermissionList: "/api/session/{sessionID}/permission",
  v2SessionPermissionReply:
    "/api/session/{sessionID}/permission/{requestID}/reply",
  v2SessionQuestionList: "/api/session/{sessionID}/question",
  v2SessionQuestionReply: "/api/session/{sessionID}/question/{requestID}/reply",
  v2SessionQuestionReject:
    "/api/session/{sessionID}/question/{requestID}/reject",
} as const satisfies Record<string, keyof OcPaths>;

export type OcPathName = keyof typeof OC_PATH_TEMPLATES;

/**
 * Percent-encode one path segment after validating it with the same rule the
 * proxy applies to session ids, so a hostile id can never add a segment.
 */
function encodePathId(id: string): string {
  assertSafeOpenCodeSessionId(id);
  return encodeURIComponent(id);
}

// ---------------------------------------------------------------------------
// v1 session paths
// ---------------------------------------------------------------------------

/** `POST` to create a session / `GET` to list them. */
export const SESSION_LIST_PATH: string = OC_PATH_TEMPLATES.sessionList;

/** Engine-wide map of `sessionID -> SessionStatus`. */
export const SESSION_STATUS_PATH: string = OC_PATH_TEMPLATES.sessionStatus;

/** SSE stream of engine events. */
export const EVENT_PATH: string = OC_PATH_TEMPLATES.event;

/** `GET`/`PATCH`/`DELETE` a single session. */
export function sessionPath(sessionId: string): string {
  return openCodeSessionPath(sessionId);
}

/** Transcript of a session. */
export function sessionMessagePath(sessionId: string): string {
  return openCodeSessionPath(sessionId, "message");
}

/** Todo list the agent maintains for a session. */
export function sessionTodoPath(sessionId: string): string {
  return openCodeSessionPath(sessionId, "todo");
}

/** Working-tree diff produced by a session. */
export function sessionDiffPath(sessionId: string): string {
  return openCodeSessionPath(sessionId, "diff");
}

/** Cancel the in-flight turn. */
export function sessionAbortPath(sessionId: string): string {
  return openCodeSessionPath(sessionId, "abort");
}

/** Fire-and-forget prompt (the WebUI never uses the blocking variant). */
export function sessionPromptAsyncPath(sessionId: string): string {
  return openCodeSessionPath(sessionId, "prompt_async");
}

/** Run a slash command inside a session. */
export function sessionCommandPath(sessionId: string): string {
  return openCodeSessionPath(sessionId, "command");
}

// ---------------------------------------------------------------------------
// Permission / question — v1 (global queue) and v2 (session-scoped)
// ---------------------------------------------------------------------------

/** v1: every pending permission request across sessions. */
export const PERMISSION_LIST_PATH: string = OC_PATH_TEMPLATES.permissionList;

/** v1: every pending question request across sessions. */
export const QUESTION_LIST_PATH: string = OC_PATH_TEMPLATES.questionList;

/** v1: reply to a permission request (the id lives under the session). */
export function permissionReplyPathV1(
  sessionId: string,
  requestId: string,
): string {
  return openCodeSessionPath(sessionId, "permissions", requestId);
}

/** v1: reply to a question (global queue, no session segment). */
export function questionReplyPathV1(requestId: string): string {
  return `/question/${encodePathId(requestId)}/reply`;
}

/** v1: reject a question (global queue, no session segment). */
export function questionRejectPathV1(requestId: string): string {
  return `/question/${encodePathId(requestId)}/reject`;
}

/** v2: pending permission requests owned by one session. */
export function sessionPermissionListPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/permission`;
}

/** v2: reply to a session-scoped permission request. */
export function permissionReplyPathV2(
  sessionId: string,
  requestId: string,
): string {
  return `/api/session/${encodePathId(sessionId)}/permission/${encodePathId(requestId)}/reply`;
}

/** v2: pending questions owned by one session. */
export function sessionQuestionListPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/question`;
}

/** v2: reply to a session-scoped question. */
export function questionReplyPathV2(
  sessionId: string,
  requestId: string,
): string {
  return `/api/session/${encodePathId(sessionId)}/question/${encodePathId(requestId)}/reply`;
}

/** v2: reject a session-scoped question. */
export function questionRejectPathV2(
  sessionId: string,
  requestId: string,
): string {
  return `/api/session/${encodePathId(sessionId)}/question/${encodePathId(requestId)}/reject`;
}
