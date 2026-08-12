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
 *
 * v2 migration status (Phase B — see `docs/specs/opencode-api-v2-migration.md`):
 * - `...PathV2` builders exist for session CRUD, prompt, message, interrupt,
 *   compact, revert, permission, question, SSE, agent/model switch, history.
 * - v1 builders remain for operations without v2 equivalents (todo, diff,
 *   command, children, summarize, fork, share, init, shell, unrevert,
 *   part-edit, session-status, session-delete, permission-ruleset-write).
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
  sessionSummarize: "/session/{sessionID}/summarize",
  sessionChildren: "/session/{sessionID}/children",
  sessionFork: "/session/{sessionID}/fork",
  sessionShare: "/session/{sessionID}/share",
  sessionInit: "/session/{sessionID}/init",
  sessionShell: "/session/{sessionID}/shell",
  sessionRevert: "/session/{sessionID}/revert",
  sessionUnrevert: "/session/{sessionID}/unrevert",
  sessionPartEdit:
    "/session/{sessionID}/message/{messageID}/part/{partID}",

  // --- v1: global permission / question queues ----------------------------
  permissionList: "/permission",
  questionList: "/question",
  questionReply: "/question/{requestID}/reply",
  questionReject: "/question/{requestID}/reject",

  // --- v1: misc -----------------------------------------------------------
  event: "/event",

  // --- v2: session-scoped permission / question (existing) ---------------
  v2SessionPermissionList: "/api/session/{sessionID}/permission",
  v2SessionPermissionReply:
    "/api/session/{sessionID}/permission/{requestID}/reply",
  v2SessionQuestionList: "/api/session/{sessionID}/question",
  v2SessionQuestionReply: "/api/session/{sessionID}/question/{requestID}/reply",
  v2SessionQuestionReject:
    "/api/session/{sessionID}/question/{requestID}/reject",

  // --- v2: session CRUD / prompt / message / interrupt / compact ----------
  v2SessionList: "/api/session",
  v2SessionActive: "/api/session/active",
  v2Session: "/api/session/{sessionID}",
  v2SessionPrompt: "/api/session/{sessionID}/prompt",
  v2SessionMessage: "/api/session/{sessionID}/message",
  v2SessionInterrupt: "/api/session/{sessionID}/interrupt",
  v2SessionCompact: "/api/session/{sessionID}/compact",

  // --- v2: SSE / history / context / agent / model -----------------------
  v2SessionEvent: "/api/session/{sessionID}/event",
  v2SessionHistory: "/api/session/{sessionID}/history",
  v2SessionContext: "/api/session/{sessionID}/context",
  v2SessionAgent: "/api/session/{sessionID}/agent",
  v2SessionModel: "/api/session/{sessionID}/model",

  // --- v2: global permission / question queues ---------------------------
  v2Event: "/api/event",
  v2PermissionRequest: "/api/permission/request",
  v2PermissionSaved: "/api/permission/saved",
  v2PermissionSavedDelete: "/api/permission/saved/{id}",
  v2QuestionRequest: "/api/question/request",

  // --- v2: revert (split into 3 endpoints) -------------------------------
  v2SessionRevertStage: "/api/session/{sessionID}/revert/stage",
  v2SessionRevertCommit: "/api/session/{sessionID}/revert/commit",
  v2SessionRevertClear: "/api/session/{sessionID}/revert/clear",
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
// v1 permission / question — global queue
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

// ---------------------------------------------------------------------------
// v2 session-scoped permission / question (existing)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// v2 session CRUD / prompt / message / interrupt / compact (Phase B)
// ---------------------------------------------------------------------------

/** v2: `GET` / `POST` to create or list sessions. */
export const SESSION_LIST_PATH_V2: string = OC_PATH_TEMPLATES.v2SessionList;

/** v2: list active sessions (replaces `/session/status` with shape transform). */
export const SESSION_ACTIVE_PATH_V2: string = OC_PATH_TEMPLATES.v2SessionActive;

/** v2: `GET` a single session. */
export function sessionPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}`;
}

/** v2: send a prompt (replaces `prompt_async`). */
export function sessionPromptPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/prompt`;
}

/** v2: get transcript (replaces `/session/{id}/message`). */
export function sessionMessagePathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/message`;
}

/** v2: interrupt (replaces `/session/{id}/abort`). */
export function sessionInterruptPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/interrupt`;
}

/** v2: compact context (replaces `/session/{id}/summarize`). */
export function sessionCompactPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/compact`;
}

// ---------------------------------------------------------------------------
// v2 SSE / history / context / agent / model (Phase B)
// ---------------------------------------------------------------------------

/** v2: global SSE stream (replaces `/event`). */
export const EVENT_PATH_V2: string = OC_PATH_TEMPLATES.v2Event;

/** v2: session-scoped SSE stream. */
export function sessionEventPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/event`;
}

/** v2: session history. */
export function sessionHistoryPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/history`;
}

/** v2: session context (transcript with parts). */
export function sessionContextPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/context`;
}

/** v2: switch agent. */
export function sessionAgentPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/agent`;
}

/** v2: switch model. */
export function sessionModelPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/model`;
}

// ---------------------------------------------------------------------------
// v2 global permission / question queues (Phase B)
// ---------------------------------------------------------------------------

/** v2: every pending permission request across sessions. */
export const PERMISSION_REQUEST_PATH_V2: string =
  OC_PATH_TEMPLATES.v2PermissionRequest;

/** v2: every pending question request across sessions. */
export const QUESTION_REQUEST_PATH_V2: string =
  OC_PATH_TEMPLATES.v2QuestionRequest;

/** v2: list saved permissions. */
export const PERMISSION_SAVED_PATH_V2: string = OC_PATH_TEMPLATES.v2PermissionSaved;

/** v2: delete a saved permission. */
export function permissionSavedDeletePathV2(id: string): string {
  return `/api/permission/saved/${encodePathId(id)}`;
}

// ---------------------------------------------------------------------------
// v2 revert — split into 3 endpoints (Phase B)
// ---------------------------------------------------------------------------

/** v2: stage a revert. */
export function sessionRevertStagePathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/revert/stage`;
}

/** v2: commit a staged revert. */
export function sessionRevertCommitPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/revert/commit`;
}

/** v2: clear a staged revert. */
export function sessionRevertClearPathV2(sessionId: string): string {
  return `/api/session/${encodePathId(sessionId)}/revert/clear`;
}

// ---------------------------------------------------------------------------
// Active selectors — the ONLY generation switch point (Phase D)
//
// These resolve v2-migration-target operations to the builder for the
// generation selected by `OPENCODE_API_GENERATION` (see
// `opencode-generation.ts`). v1-maintain operations (todo, diff, command,
// children, session DELETE/PATCH, ...) keep their v1 builders and are NOT
// routed through here, so the two generations never mix for one operation.
// ---------------------------------------------------------------------------

import { isV2ApiGeneration } from "./opencode-generation";

/** GET a single session. (Session DELETE/PATCH stays v1 — no v2 equivalent.) */
export function activeSessionGetPath(sessionId: string): string {
  return isV2ApiGeneration() ? sessionPathV2(sessionId) : sessionPath(sessionId);
}

/** Transcript of a session. */
export function activeSessionMessagePath(sessionId: string): string {
  return isV2ApiGeneration() ? sessionMessagePathV2(sessionId)
    : sessionMessagePath(sessionId);
}

/** Fire-and-forget prompt. */
export function activePromptPath(sessionId: string): string {
  return isV2ApiGeneration() ? sessionPromptPathV2(sessionId)
    : sessionPromptAsyncPath(sessionId);
}

/** Cancel the in-flight turn (v2 renames abort → interrupt). */
export function activeInterruptPath(sessionId: string): string {
  return isV2ApiGeneration() ? sessionInterruptPathV2(sessionId)
    : sessionAbortPath(sessionId);
}

/** Context compaction (client already uses the v2 path; kept for one place). */
export function activeCompactPath(sessionId: string): string {
  return sessionCompactPathV2(sessionId);
}

/** SSE event stream (global). */
export function activeEventPath(): string {
  return isV2ApiGeneration() ? EVENT_PATH_V2 : EVENT_PATH;
}

/** Pending permission requests across sessions. */
export function activePermissionListPath(): string {
  return isV2ApiGeneration() ? PERMISSION_REQUEST_PATH_V2 : PERMISSION_LIST_PATH;
}

/** Pending question requests across sessions. */
export function activeQuestionListPath(): string {
  return isV2ApiGeneration() ? QUESTION_REQUEST_PATH_V2 : QUESTION_LIST_PATH;
}

/** Reply to a permission request (follows the request's generation). */
export function activePermissionReplyPath(
  sessionId: string,
  requestId: string,
): string {
  return isV2ApiGeneration() ? permissionReplyPathV2(sessionId, requestId)
    : permissionReplyPathV1(sessionId, requestId);
}

/** Reply to a question (follows the request's generation). */
export function activeQuestionReplyPath(
  sessionId: string,
  requestId: string,
): string {
  return isV2ApiGeneration() ? questionReplyPathV2(sessionId, requestId)
    : questionReplyPathV1(requestId);
}

/** Reject a question (follows the request's generation). */
export function activeQuestionRejectPath(
  sessionId: string,
  requestId: string,
): string {
  return isV2ApiGeneration() ? questionRejectPathV2(sessionId, requestId)
    : questionRejectPathV1(requestId);
}

/** Stage a revert (v2 splits the v1 single revert into stage → commit). */
export function activeRevertStagePath(sessionId: string): string {
  return isV2ApiGeneration() ? sessionRevertStagePathV2(sessionId)
    : `/session/${encodePathId(sessionId)}/revert`;
}

/** Commit a staged revert. v1 has no separate commit (the single call commits). */
export function activeRevertCommitPath(sessionId: string): string {
  return isV2ApiGeneration() ? sessionRevertCommitPathV2(sessionId)
    : `/session/${encodePathId(sessionId)}/revert`;
}

/** Clear a staged revert (v1 has no equivalent; returns the v2 path). */
export function activeRevertClearPath(sessionId: string): string {
  return isV2ApiGeneration() ? sessionRevertClearPathV2(sessionId)
    : `/session/${encodePathId(sessionId)}/unrevert`;
}
