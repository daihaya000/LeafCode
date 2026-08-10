import { getDb, getWorkspace, listSessionBindings, touchSessionActivity } from "./db";
import { sweepIdleExtractions } from "./memory-idle";
import { isIntelligenceVariant, type IntelligenceVariant } from "./model-variants";
import { OcError, ocServer } from "./oc-server";
import { assertSafeOpenCodeSessionId } from "./opencode-id";
import {
  SESSION_STATUS_PATH,
  sessionAbortPath,
  sessionMessagePath,
  sessionPromptAsyncPath,
} from "./opencode-paths";
import type { MessageWithParts, SessionStatus } from "./types";
import { scheduleAutoExtractAfterGoalCompleted } from "./goal-memory-hook";
import { memoryInjectionFor } from "./memory";
import {
  collaborationContextFor,
  prependCollaborationContext,
} from "./collaboration-context";

export type GoalLoopStatus =
  | "queued"
  | "running"
  | "paused"
  | "verifying_completed"
  | "completed"
  | "blocked"
  | "stopped";

/**
 * Which prompt the current (or most recent) `running` turn is answering.
 * Stored explicitly because inferring it from the tail of `progress` misreads a
 * normal goal reply as a verification reply after a pause/resume, which made a
 * completion claim unreachable. See docs/specs/goal-loop.md invariant I6.
 */
export type GoalLoopTurnKind = "goal" | "verification";

/**
 * Why a loop is `paused`. Stored as an enum instead of being matched out of the
 * Japanese `error` text: rewording the message used to silently change control
 * flow. See docs/specs/goal-loop.md invariant I5.
 */
export type GoalLoopPauseReason =
  | ""
  | "user"
  | "manual_send"
  | "turn_limit"
  | "unreadable_result"
  | "turn_timeout"
  | "unknown_delivery"
  | "transcript_unreadable"
  | "boundary_lost"
  | "verification_rejected"
  | "scheduler_error";

const GOAL_LOOP_PAUSE_REASONS = new Set<string>([
  "",
  "user",
  "manual_send",
  "turn_limit",
  "unreadable_result",
  "turn_timeout",
  "unknown_delivery",
  "transcript_unreadable",
  "boundary_lost",
  "verification_rejected",
  "scheduler_error",
]);

function toPauseReason(value: unknown): GoalLoopPauseReason {
  return typeof value === "string" && GOAL_LOOP_PAUSE_REASONS.has(value)
    ? (value as GoalLoopPauseReason)
    : "";
}

function toTurnKind(value: unknown): GoalLoopTurnKind {
  return value === "verification" ? "verification" : "goal";
}

export type GoalLoopProgress = {
  time: string;
  status: "progress" | "completed" | "verifying_completed" | "verified_completed" | "blocked";
  summary: string;
  next?: string;
  evidence?: string;
};

export type GoalLoopDto = {
  id: string;
  workspaceId: string;
  sessionId: string;
  status: GoalLoopStatus;
  goal: string;
  acceptance: string[];
  maxTurns: number;
  turnCount: number;
  lastMessageId: string | null;
  lastPromptAt: string | null;
  agent: string | null;
  providerID: string | null;
  modelID: string | null;
  variant: IntelligenceVariant | null;
  progress: GoalLoopProgress[];
  summary: string;
  evidence: string;
  blockedReason: string;
  error: string;
  revision: number;
  turnKind: GoalLoopTurnKind;
  pauseReason: GoalLoopPauseReason;
  rejectedClaims: number;
  pauseRequested: boolean;
  createdAt: string;
  updatedAt: string;
};

type GoalLoopRow = {
  id: string;
  workspace_id: string;
  opencode_session_id: string;
  status: GoalLoopStatus;
  goal: string;
  acceptance: string;
  max_turns: number;
  turn_count: number;
  last_message_id: string | null;
  last_prompt_at: string | null;
  agent: string | null;
  provider_id: string | null;
  model_id: string | null;
  variant: string | null;
  progress: string;
  summary: string;
  evidence: string;
  blocked_reason: string;
  error: string;
  revision: number;
  turn_kind: string;
  pause_reason: string;
  rejected_claims: number;
  pause_requested: number;
  created_at: string;
  updated_at: string;
};

type StatusMap = Record<string, SessionStatus>;

const TERMINAL_STATUSES: GoalLoopStatus[] = ["completed", "blocked", "stopped"];
const SCHEDULER_INTERVAL_MS = 2_500;
/**
 * `prompt_async` normally returns 202 immediately, but under engine load the
 * prompt construction can take longer. 60s was too tight and surfaced raw
 * "The operation was aborted due to timeout" errors on busy loops, so allow
 * 120s. Still well under the BFF's long-running mutation ceiling (290s), and a
 * send that exceeds it pauses with `prompt_unknown` rather than double-sending.
 */
const PROMPT_TIMEOUT_MS = 120_000;
const STATUS_TIMEOUT_MS = 5_000;
const MESSAGE_TIMEOUT_MS = 10_000;
/**
 * Aborting is a best-effort courtesy on the stop path. It must not inherit
 * PROMPT_TIMEOUT_MS: a wedged engine would then hold the stop request for two
 * minutes even though the loop row is already terminal.
 */
const ABORT_TIMEOUT_MS = 10_000;
/** Bound transient OpenCode failures so one scheduler tick never retries forever. */
const OPENCODE_RETRY_ATTEMPTS = 3;
const OPENCODE_RETRY_DELAY_MS = 100;
/** Transcript silence that proves a multi-step turn ended (steps are ms apart). */
const TURN_QUIET_MS = 5_000;
/** Longer silence before declaring a finished turn had no structured result. */
const STRUCTURED_GRACE_MS = 60_000;
/** A `running` turn with no readable reply after this long is paused. */
const TURN_TIMEOUT_MS = 30 * 60_000;
const MAX_ACCEPTANCE_ITEMS = 10;
const MAX_GOAL_CHARS = 12_000;
/**
 * How many times an agent may claim `completed` and have the independent
 * verification turn reject it before we pause the loop. Without this cap the
 * agent can alternate claim→reject until maxTurns is exhausted, spending the
 * whole budget on verification round-trips instead of real work.
 */
const MAX_REJECTED_CLAIMS = 2;
const MAX_ACCEPTANCE_CHARS = 2_000;
const GOAL_LOOP_PROMPT_MARKER = "<!-- webui-goal-loop-prompt -->";

let schedulerStarted = false;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerTicking = false;

function transientOpenCodeStatus(err: unknown): number | null {
  if (err instanceof OcError) return err.status;
  if (
    err &&
    typeof err === "object" &&
    "status" in err &&
    typeof (err as { status?: unknown }).status === "number"
  ) {
    return (err as { status: number }).status;
  }
  return null;
}

/** Network errors have no status; only retry known transient HTTP failures. */
function isTransientOpenCodeError(err: unknown): boolean {
  const status = transientOpenCodeStatus(err);
  return status === null || status === 408 || (status >= 500 && status <= 599);
}

/**
 * HTTP statuses that mean "the prompt was NOT accepted, but resending
 * immediately is unsafe or pointless". 409 (SessionBusyError) means the
 * engine is already processing a prompt for this session — resending would
 * either duplicate or immediately re-hit the busy state. 429 (rate limit)
 * means the caller should back off, not retry right away. Treating these as
 * ambiguous delivery (pause for a user decision) avoids a tight retry loop
 * while preserving the non-idempotent prompt_async safety contract.
 */
const PROMPT_TRANSIENT_CONFLICT_STATUSES = new Set([409, 429]);

/** True when `err` is a 409/429 that should pause instead of rollback+resend. */
function isTransientConflictPrompt(err: unknown): boolean {
  const status = transientOpenCodeStatus(err);
  return status !== null && PROMPT_TRANSIENT_CONFLICT_STATUSES.has(status);
}

/**
 * `prompt_async` is non-idempotent. A network failure, timeout, or server
 * failure may have accepted it despite the missing response, whereas a client
 * error is an acknowledgement that OpenCode rejected the prompt. 409/429 are
 * excluded: they are not a definite rejection, but an immediate resend is
 * unsafe (busy session / rate limited), so the caller pauses instead.
 */
function isDefinitelyRejectedPrompt(err: unknown): boolean {
  const status = transientOpenCodeStatus(err);
  return (
    status !== null &&
    status !== 408 &&
    !isTransientConflictPrompt(err) &&
    status >= 400 &&
    status <= 499
  );
}

function promptErrorMessage(prefix: string, err: unknown): string {
  const detail = err instanceof Error ? err.message : "OpenCode がプロンプトを拒否しました。";
  return `${prefix}: ${Array.from(detail).slice(0, 3500).join("")}`;
}

async function retryTransientOpenCode<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= OPENCODE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (!isTransientOpenCodeError(err) || attempt === OPENCODE_RETRY_ATTEMPTS) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, OPENCODE_RETRY_DELAY_MS * attempt);
      });
    }
  }
  throw lastError;
}

function safeJsonArray<T>(value: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function toDto(row: GoalLoopRow): GoalLoopDto {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.opencode_session_id,
    status: row.status,
    goal: row.goal,
    acceptance: safeJsonArray<string>(row.acceptance, []),
    maxTurns: row.max_turns,
    turnCount: row.turn_count,
    lastMessageId: row.last_message_id,
    lastPromptAt: row.last_prompt_at,
    agent: row.agent,
    providerID: row.provider_id,
    modelID: row.model_id,
    variant: isIntelligenceVariant(row.variant) ? row.variant : null,
    progress: safeJsonArray<GoalLoopProgress>(row.progress, []),
    summary: row.summary,
    evidence: row.evidence,
    blockedReason: row.blocked_reason,
    error: row.error,
    revision: row.revision,
    turnKind: toTurnKind(row.turn_kind),
    pauseReason: toPauseReason(row.pause_reason),
    rejectedClaims: row.rejected_claims ?? 0,
    pauseRequested: row.pause_requested === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeAcceptance(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_ACCEPTANCE_CHARS) return null;
    out.push(trimmed);
  }
  // Reject rather than silently truncate: dropping acceptance criteria would let
  // the loop verify against a different contract than the caller submitted.
  if (out.length > MAX_ACCEPTANCE_ITEMS) return null;
  return out;
}

function latestMessageId(messages: MessageWithParts[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const id = messages[i]?.info?.id;
    if (id) return id;
  }
  return null;
}

/**
 * OpenCode splits one turn into many assistant messages (one per step), and
 * only the last one carries the result payload we asked for. The latest
 * message is therefore the only safe candidate: scanning backwards could
 * consume an earlier completed result while a newer assistant step is still
 * silent or streaming.
 */
function finalAssistantAfter(
  messages: MessageWithParts[],
  lastMessageId: string | null,
): MessageWithParts | null {
  const start = boundaryStartIndex(messages, lastMessageId);
  // The boundary is gone (reverted or pruned): we cannot tell this turn's reply
  // from work that predates the loop, so refuse to pick one.
  if (start === null) return null;
  if (start >= messages.length) return null;
  const last = messages[messages.length - 1];
  return last?.info.role === "assistant" && typeof last.info.time?.completed === "number"
    ? last
    : null;
}

/**
 * Index just past the read boundary, or `null` when the boundary message is no
 * longer in the transcript.
 *
 * Returning `-1 + 1 === 0` for a missing boundary made the caller scan the
 * whole transcript, so a reverted boundary let a reply from before the loop
 * started be consumed as the current turn's result (and could jump the loop
 * straight to `verifying_completed`). See docs/specs/goal-loop.md invariant I4.
 */
function boundaryStartIndex(
  messages: MessageWithParts[],
  lastMessageId: string | null,
): number | null {
  if (!lastMessageId) return 0;
  const index = messages.findIndex((m) => m.info.id === lastMessageId);
  return index < 0 ? null : index + 1;
}

/** True when the loop has a read boundary that is no longer in the transcript. */
function boundaryLost(messages: MessageWithParts[], lastMessageId: string | null): boolean {
  return boundaryStartIndex(messages, lastMessageId) === null;
}

/**
 * `/session/status` omits sessions the engine is not actively tracking, so it
 * cannot prove a turn ended. Fall back to the transcript: the last message must
 * be a completed assistant that has stayed quiet for `quietMs`. Consecutive
 * step messages are created within milliseconds of each other, so any real gap
 * means the turn is over.
 */
function transcriptIdleFor(
  messages: MessageWithParts[],
  quietMs: number,
  now: number = Date.now(),
): boolean {
  const last = messages[messages.length - 1];
  if (!last) return true;
  if (last.info.role !== "assistant") return false;
  const completed = last.info.time?.completed;
  if (typeof completed !== "number") return false;
  return now - completed >= quietMs;
}

export function getGoalLoop(workspaceId: string): GoalLoopDto | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM goal_loops
       WHERE workspace_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(workspaceId) as GoalLoopRow | undefined;
  return row ? toDto(row) : null;
}

export function listRunnableGoalLoops(): GoalLoopDto[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM goal_loops
       WHERE status IN ('queued', 'running', 'verifying_completed')
       ORDER BY updated_at ASC`,
    )
    .all() as GoalLoopRow[];
  return rows.map(toDto);
}

export async function createGoalLoop(input: {
  workspaceId: string;
  sessionId: string;
  goal: string;
  acceptance?: unknown;
  maxTurns?: unknown;
  agent?: unknown;
  model?: unknown;
  variant?: unknown;
}): Promise<GoalLoopDto> {
  const ws = getWorkspace(input.workspaceId);
  if (!ws) throw new OcError("task not found", 404);
  try {
    assertSafeOpenCodeSessionId(input.sessionId);
  } catch {
    throw new OcError("invalid sessionId", 400);
  }
  const bound = listSessionBindings(input.workspaceId).some(
    (b) => b.opencode_session_id === input.sessionId,
  );
  if (!bound) throw new OcError("session binding not found", 404);

  const goal = input.goal.trim();
  if (!goal || goal.length > MAX_GOAL_CHARS) {
    throw new OcError("invalid goal", 400);
  }
  const acceptance = normalizeAcceptance(input.acceptance);
  if (acceptance === null) throw new OcError("invalid acceptance", 400);
  // `updateGoalLoopMaxTurns` truncates non-integers; do the same here so the
  // create and update paths agree instead of silently falling back to 10.
  const maxTurnsRaw = Number(input.maxTurns ?? 10);
  const maxTurns = Number.isFinite(maxTurnsRaw)
    ? Math.min(Math.max(Math.trunc(maxTurnsRaw), 1), 100)
    : 10;
  const agent = typeof input.agent === "string" && input.agent.trim() ? input.agent.trim() : null;
  const model =
    input.model && typeof input.model === "object" && !Array.isArray(input.model)
      ? (input.model as Record<string, unknown>)
      : null;
  const providerID = typeof model?.providerID === "string" ? model.providerID : null;
  const modelID = typeof model?.modelID === "string" ? model.modelID : null;
  const variant = isIntelligenceVariant(input.variant) ? input.variant : null;

  let messages: MessageWithParts[] = [];
  let transcriptReadable = true;
  try {
    messages = await ocServer<MessageWithParts[]>(
      ws.absolute_path,
      sessionMessagePath(input.sessionId),
      { timeoutMs: MESSAGE_TIMEOUT_MS },
    );
  } catch {
    // A missing transcript cannot prove that the session is idle. Start paused
    // rather than treating it as [] and potentially sending over an unseen turn.
    transcriptReadable = false;
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const tx = getDb().transaction(() => {
    getDb()
      .prepare(
        `UPDATE goal_loops
         SET status = 'stopped', revision = revision + 1, updated_at = ?
         WHERE workspace_id = ? AND status IN ('queued', 'running', 'paused', 'verifying_completed')`,
      )
      .run(now, input.workspaceId);
    getDb()
      .prepare(
        `INSERT INTO goal_loops
          (id, workspace_id, opencode_session_id, status, goal, acceptance, max_turns,
           last_message_id, agent, provider_id, model_id, variant, error, pause_reason,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.sessionId,
        transcriptReadable ? "queued" : "paused",
        goal,
        JSON.stringify(acceptance),
        maxTurns,
        latestMessageId(messages),
        agent,
        providerID,
        modelID,
        variant,
        transcriptReadable
          ? ""
          : "会話履歴を読めないため、重複送信を防止して一時停止しました。再開してください。",
        transcriptReadable ? "" : "transcript_unreadable",
        now,
        now,
      );
  });
  tx();
  touchSessionActivity(input.workspaceId, input.sessionId, now);
  if (transcriptReadable) void runGoalLoopSchedulerTick();
  return getGoalLoop(input.workspaceId)!;
}

export async function updateGoalLoopStatus(
  workspaceId: string,
  action: "pause" | "resume" | "stop",
): Promise<GoalLoopDto | null> {
  const loop = getGoalLoop(workspaceId);
  if (!loop) return null;
  const now = new Date().toISOString();
  if (action === "pause") {
    const paused = getDb()
      .prepare(
        `UPDATE goal_loops
         SET status = 'paused', pause_requested = 0, pause_reason = 'user', error = '',
             turn_kind = CASE WHEN status = 'verifying_completed' THEN 'verification' ELSE turn_kind END,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND status IN ('queued', 'running', 'verifying_completed')`,
      )
      .run(now, loop.id, loop.revision);
    // Abort the in-flight OpenCode request after the loop is paused in the DB.
    // The revision bump makes any late result harmless if abort races with it.
    if (paused.changes > 0 && (loop.status === "running" || loop.status === "verifying_completed")) {
      const ws = getWorkspace(workspaceId);
      if (ws) {
        await ocServer(ws.absolute_path, sessionAbortPath(loop.sessionId), {
          method: "POST",
          timeoutMs: ABORT_TIMEOUT_MS,
        }).catch(() => undefined);
      }
    }
  } else if (action === "resume") {
    // Re-anchor the read boundary to the current transcript tail so any
    // messages that arrived while paused (e.g. a manual user send) are not
    // mistaken for the loop's own turn result on the next tick.
    const ws = getWorkspace(workspaceId);
    let tailMessageId: string | null;
    let messages: MessageWithParts[];
    try {
      if (!ws) throw new Error("workspace missing");
      messages = await ocServer<MessageWithParts[]>(
        ws.absolute_path,
        sessionMessagePath(loop.sessionId),
        { timeoutMs: MESSAGE_TIMEOUT_MS },
      );
      tailMessageId = latestMessageId(messages);
    } catch {
      // Do not resume to queued without a fresh transcript boundary: an empty
      // fallback could make the next tick layer a loop prompt over unseen work.
      getDb()
        .prepare(
          `UPDATE goal_loops SET error = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND status = 'paused'`,
        )
        .run(
          "会話履歴を読めないため再開できません。重複送信を防止するため、接続回復後に再試行してください。",
          now,
          loop.id,
          loop.revision,
        );
      return getGoalLoop(workspaceId);
    }
    const recovered =
      isUnknownPromptDeliveryPause(loop)
        ? deliveredGoalResultAfterUnknownPrompt(messages, loop.lastMessageId)
        : null;
    if (recovered) {
      // The prompt may have reached OpenCode before the client timed out. Its
      // marked user prompt and structured reply prove which turn completed, so
      // apply it instead of tail re-anchoring and silently losing progress.
      const claimed = getDb()
        .prepare(
          `UPDATE goal_loops
           SET status = 'running', error = '', pause_reason = '',
               revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND status = 'paused' AND last_message_id IS ?`,
        )
        .run(now, loop.id, loop.revision, loop.lastMessageId);
      if (claimed.changes === 0) return getGoalLoop(workspaceId);
      applyAssistantResult(
        { ...loop, status: "running", error: "", pauseReason: "", revision: loop.revision + 1 },
        recovered.assistant,
        recovered.result,
      );
      const recoveredLoop = getGoalLoop(workspaceId);
      if (recoveredLoop?.status === "queued" || recoveredLoop?.status === "verifying_completed") {
        void runGoalLoopSchedulerTick();
      }
      return recoveredLoop;
    }
    if (isUnknownPromptDeliveryPause(loop)) {
      // Re-queuing here could resend a request that OpenCode is still handling.
      // Keep the explanation visible and let a later resume re-check the
      // transcript for a marked structured result.
      getDb()
        .prepare(
          `UPDATE goal_loops SET error = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND status = 'paused'`,
        )
        .run(
          "プロンプトの送達を確認できず、完了結果もまだ確認できません。重複送信を防ぐため一時停止を維持しています。しばらく待って再開してください。",
          now,
          loop.id,
          loop.revision,
        );
      return getGoalLoop(workspaceId);
    }
    // A loop paused during the verification phase must resume into
    // `verifying_completed`, not `queued`. Resuming to `queued` used to send a
    // goal prompt and then misread its reply as a verification result, which
    // made the completion claim unreachable. See docs/specs/goal-loop.md 遷移 22.
    const resumeStatus: GoalLoopStatus =
      loop.turnKind === "verification" ? "verifying_completed" : "queued";
    // Resuming a loop that was stopped for repeated rejected claims is a
    // deliberate "continue anyway", so clear the counter. Leaving it at the cap
    // would re-pause on the very next rejection and block all further progress.
    const resumeRejectedClaims =
      loop.pauseReason === "verification_rejected" ? 0 : loop.rejectedClaims;
    getDb()
      .prepare(
        `UPDATE goal_loops
         SET status = ?, error = '', pause_reason = '', pause_requested = 0, rejected_claims = ?, last_message_id = ?,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND status = 'paused'`,
      )
      .run(resumeStatus, resumeRejectedClaims, tailMessageId, now, loop.id, loop.revision);
    void runGoalLoopSchedulerTick();
  } else {
    const stopped = getDb()
      .prepare(
        `UPDATE goal_loops SET status = 'stopped', revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND status NOT IN ('completed', 'blocked', 'stopped')`,
      )
      .run(now, loop.id, loop.revision);
    const ws = getWorkspace(workspaceId);
    if (ws && stopped.changes > 0) {
      await ocServer(ws.absolute_path, sessionAbortPath(loop.sessionId), {
        method: "POST",
        timeoutMs: ABORT_TIMEOUT_MS,
      }).catch(() => undefined);
    }
  }
  return getGoalLoop(workspaceId);
}

/**
 * Update `maxTurns` on a goal loop. Only allowed while `paused` — the
 * scheduler treats `queued`/`running` loops as actively in-flight and changing
 * their cap mid-turn would race the tick. Returns the updated loop, or `null`
 * if no loop exists. Throws `OcError(409)` when the loop is not paused.
 */
export function updateGoalLoopMaxTurns(
  workspaceId: string,
  maxTurns: unknown,
): GoalLoopDto | null {
  const loop = getGoalLoop(workspaceId);
  if (!loop) return null;
  if (loop.status !== "paused") {
    throw new OcError("goal loop is not paused", 409);
  }
  const raw = Number(maxTurns);
  if (!Number.isFinite(raw)) {
    throw new OcError("invalid maxTurns", 400);
  }
  const clamped = Math.min(100, Math.max(1, Math.trunc(raw)));
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE goal_loops SET max_turns = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`,
    )
    .run(clamped, now, loop.id, loop.revision);
  return getGoalLoop(workspaceId);
}

/**
 * Result of trying to pause a loop before a manual send.
 * `noLoop` — nothing to pause (no loop, different session, or already stopped).
 * `paused` — a live loop was paused; the manual send may proceed.
 * `conflict` — a live loop could not be paused (another writer won the CAS);
 * the caller must not send, or it would interleave with a loop turn.
 */
export type ManualSendPauseResult = "noLoop" | "paused" | "conflict";

const MANUAL_SEND_PAUSABLE: GoalLoopStatus[] = ["queued", "running", "verifying_completed"];

export async function pauseGoalLoopForManualSend(
  workspaceId: string,
  sessionId: string,
): Promise<ManualSendPauseResult> {
  const loop = getGoalLoop(workspaceId);
  if (!loop || loop.sessionId !== sessionId) return "noLoop";
  if (!MANUAL_SEND_PAUSABLE.includes(loop.status)) return "noLoop";
  const ws = getWorkspace(workspaceId);
  let tailMessageId = loop.lastMessageId;
  if (ws) {
    try {
      const messages = await ocServer<MessageWithParts[]>(
        ws.absolute_path,
        sessionMessagePath(loop.sessionId),
        { timeoutMs: MESSAGE_TIMEOUT_MS },
      );
      tailMessageId = latestMessageId(messages);
    } catch {
      // Still pause for the manual send, but retain the old boundary. A later
      // resume requires a successful fresh read before it can queue anything.
    }
  }
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE goal_loops
       SET status = 'paused', pause_reason = 'manual_send',
           error = '手動送信が行われたため一時停止しました。',
           turn_kind = CASE WHEN status = 'verifying_completed' THEN 'verification' ELSE turn_kind END,
           last_message_id = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND opencode_session_id = ? AND revision = ?
         AND status IN ('queued', 'running', 'verifying_completed')`,
    )
    .run(tailMessageId, now, workspaceId, sessionId, loop.revision);
  // The CAS can fail when the scheduler advanced the loop while we were reading
  // the transcript. Re-read rather than trusting `changes`: another writer may
  // already have parked the loop in a state that is safe to send over.
  const after = getGoalLoop(workspaceId);
  if (!after || after.sessionId !== sessionId) return "noLoop";
  return MANUAL_SEND_PAUSABLE.includes(after.status) ? "conflict" : "paused";
}

/**
 * Prefixes the goal prompt with the approved-memory block on the very first
 * turn. `isFirstTurn` true only for turn 1; later turns reuse the same prompt
 * shape unmodified. Returns the untruncated prompt text.
 */
function buildGoalPromptWithMemory(
  loop: GoalLoopDto,
  turnNumber: number,
  maxTurns: number,
): string {
  const prompt = buildGoalPrompt(loop, turnNumber, maxTurns);
  if (turnNumber !== 1) return prompt;
  const memory = memoryInjectionFor(loop.workspaceId);
  return memory ? `${memory}\n${prompt}` : prompt;
}

/**
 * One prompt = one loop turn. The agent cannot see the loop counter from
 * inside the session, so without it being stated explicitly agents compress
 * every remaining step into a single turn (and even narrate turns that never
 * ran) instead of letting the WebUI drive the next iteration.
 */
function buildGoalPrompt(loop: GoalLoopDto, turnNumber: number, maxTurns: number): string {
  const acceptance = loop.acceptance.length
    ? `\n\nAcceptance criteria:\n${loop.acceptance.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
    : "";
  const recent = loop.progress.length
    ? `\n\nRecent progress:\n${loop.progress
        .slice(-5)
        .map((p) => `- ${p.time}: ${p.summary}${p.next ? ` / next: ${p.next}` : ""}`)
        .join("\n")}`
    : "";
  return `<!-- webui-goal-loop-prompt -->

You are running a WebUI native persistent goal loop. Work on the next smallest useful step toward the goal. Prefer code changes, tests, typechecks, builds, and concrete evidence over discussion.

This is turn ${turnNumber} of at most ${maxTurns}. ${turnNumber - 1} loop turn(s) completed before this one. The WebUI sends the next prompt automatically after this turn ends.

Rules:
- One turn = one iteration. Do the smallest useful increment, then end this turn and let the WebUI prompt you again. Do not chain the remaining steps to finish the whole goal in a single turn.
- Report only work you actually performed in this turn. Never simulate, narrate, or count future turns as if they already happened.
- Write a brief human-readable summary before the JSON block. Do not make the JSON block your only output; the WebUI hides that internal block in the chat.
- Continue autonomously until the goal is completed, blocked, paused, or stopped by the WebUI.
- Do not ask the user questions unless truly blocked.
- Do not claim completion unless the goal and acceptance criteria are satisfied. A completed claim will be independently verified before the loop ends.
- Keep changes incremental and reviewable.
- Follow repository safety instructions and avoid destructive operations.

Goal:
${loop.goal}${acceptance}${recent}

The very last thing you output this turn must be a single fenced JSON block:

\`\`\`json
{"status":"progress","summary":"what changed this turn","next":"the next step","evidence":"commands run, files touched, results"}
\`\`\`

- status must be exactly one of: progress, completed, blocked.
- progress: meaningful progress was made but the goal is not complete.
- completed: the goal is complete with concrete evidence.
- blocked: user input or manual intervention is required (put the reason in blockedReason).
- summary is required. Write nothing after the closing fence.`;
}

function buildVerificationPrompt(
  loop: GoalLoopDto,
  turnsExecuted: number,
  maxTurns: number,
): string {
  const claim = loop.progress.at(-1);
  const acceptance = loop.acceptance.length
    ? `\n\nAcceptance criteria to verify:\n${loop.acceptance.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
    : "";
  return `<!-- webui-goal-loop-prompt -->

The previous turn claimed the goal was completed. Your job this turn is to independently verify that claim. Do not do new work unless necessary to verify; focus on inspection, tests, or checks.

Only ${turnsExecuted} loop turn(s) of at most ${maxTurns} have actually been executed so far. Treat that count as ground truth when judging the claim.

Rules:
- Verify each acceptance criterion above and report whether the claim is actually true.
- Check the claim against the real transcript and repository state, not against the claim's own narration. Reject it (return progress) if it reports more turns, iterations, or work than the ${turnsExecuted} executed turn(s) could contain, or if the evidence is simulated rather than observable.
- Write a brief human-readable verification summary before the JSON block. Do not make the JSON block your only output; the WebUI hides that internal block in the chat.
- If the claim is fully verified, return verified_completed.
- If the claim is not fully verified or more work is needed, return progress.
- If you are blocked from verifying, return blocked.

Claimed completion:
${claim ? `summary: ${claim.summary}\nevidence: ${claim.evidence ?? "(none)"}` : "(no claim recorded)"}${acceptance}

The very last thing you output this turn must be a single fenced JSON block:

\`\`\`json
{"status":"verified_completed","summary":"verification result","evidence":"checks performed and their results"}
\`\`\`

- status must be exactly one of: verified_completed, progress, blocked.
- verified_completed: the completed claim is true and all acceptance criteria are satisfied.
- progress: the claim is not fully verified or additional work is required.
- blocked: verification cannot proceed without user input.
- summary is required. Write nothing after the closing fence.`;
}

type StructuredGoalResult = {
  status?: unknown;
  summary?: unknown;
  next?: unknown;
  evidence?: unknown;
  blockedReason?: unknown;
};

function normalizeStructured(value: unknown): GoalLoopProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as StructuredGoalResult;
  const status = raw.status;
  if (
    status !== "progress" &&
    status !== "completed" &&
    status !== "blocked" &&
    status !== "verified_completed"
  ) {
    return null;
  }
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  if (!summary) return null;
  const evidence = typeof raw.evidence === "string" ? raw.evidence.trim() : "";
  const next = typeof raw.next === "string" ? raw.next.trim() : "";
  const blocked = typeof raw.blockedReason === "string" ? raw.blockedReason.trim() : "";
  return {
    time: new Date().toISOString(),
    status,
    summary: summary.slice(0, 4000),
    ...(next ? { next: next.slice(0, 2000) } : {}),
    ...(evidence || blocked ? { evidence: (evidence || blocked).slice(0, 4000) } : {}),
  };
}

/** Top-level `{...}` spans in `text`, ignoring braces inside JSON strings. */
function jsonObjectCandidates(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      } else if (depth < 0) {
        depth = 0;
        start = -1;
      }
    }
  }
  return out;
}

function assistantText(message: MessageWithParts): string {
  return message.parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n");
}

/** A completed structured reply belonging to the marked prompt after `boundary`. */
function deliveredGoalResultAfterUnknownPrompt(
  messages: MessageWithParts[],
  boundary: string | null,
): { assistant: MessageWithParts; result: GoalLoopProgress } | null {
  // A missing boundary used to fall back to index 0, which could match a loop
  // prompt from an earlier turn and replay its result (I4).
  const start = boundaryStartIndex(messages, boundary);
  if (start === null) return null;
  let promptIndex = -1;
  for (let i = start; i < messages.length; i += 1) {
    const message = messages[i];
    if (message?.info.role === "user" && assistantText(message).includes(GOAL_LOOP_PROMPT_MARKER)) {
      promptIndex = i;
    }
  }
  if (promptIndex < 0) return null;
  let end = messages.length;
  for (let i = promptIndex + 1; i < messages.length; i += 1) {
    if (messages[i]?.info.role === "user") {
      end = i;
      break;
    }
  }
  for (let i = end - 1; i > promptIndex; i -= 1) {
    const assistant = messages[i];
    if (assistant?.info.role !== "assistant" || typeof assistant.info.time?.completed !== "number") {
      continue;
    }
    const result = extractGoalResult(assistant);
    if (result) return { assistant, result };
  }
  return null;
}

/**
 * Read the turn result. `info.structured` is preferred but this OpenCode build
 * cannot round-trip it (see the prompt body: we must not send `format`), so the
 * fenced JSON block the prompt asks for is the working path. Scan from the end
 * because the block is the last thing the model writes.
 */
function extractGoalResult(assistant: MessageWithParts): GoalLoopProgress | null {
  const direct = normalizeStructured(assistant.info.structured);
  if (direct) return direct;
  const candidates = jsonObjectCandidates(assistantText(assistant));
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidates[i]);
    } catch {
      continue;
    }
    const normalized = normalizeStructured(parsed);
    if (normalized) return normalized;
  }
  return null;
}

function applyAssistantResult(
  loop: GoalLoopDto,
  assistant: MessageWithParts,
  result: GoalLoopProgress | null,
): void {
  const now = new Date().toISOString();
  if (!result) {
    getDb()
      .prepare(
        `UPDATE goal_loops
         SET status = 'paused', pause_reason = 'unreadable_result', last_message_id = ?,
             error = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'running' AND revision = ? AND last_message_id IS ?`,
      )
      .run(
        assistant.info.id,
        "ループの結果JSONを読めなかったため一時停止しました。",
        now,
        loop.id,
        loop.revision,
        loop.lastMessageId,
      );
    return;
  }
  const progress = [...loop.progress, result].slice(-50);

  // Whether this reply answers the verification prompt is recorded on the row
  // when the prompt is claimed (`turn_kind`). It must not be inferred from the
  // tail of `progress`: after a pause/resume the status no longer says
  // "verifying" while the tail still reads `completed`, so a normal goal reply
  // was misread as a verification reply and a genuine completion claim could
  // never reach `completed`. See docs/specs/goal-loop.md invariant I6.
  const isVerificationReply = loop.status === "running" && loop.turnKind === "verification";
  // Running count of rejected completion claims. A counter column is used
  // instead of pairing entries at the tail of `progress`: any real work turn
  // between two rejections broke the pairing, so the cap never fired in the
  // case it exists for. See docs/specs/goal-loop.md 是正 E.
  const verificationRejected =
    isVerificationReply &&
    result.status !== "verified_completed" &&
    result.status !== "blocked";
  const rejectedClaims = verificationRejected
    ? loop.rejectedClaims + 1
    : isVerificationReply && result.status === "verified_completed"
    ? 0
    : loop.rejectedClaims;
  let nextStatus: GoalLoopStatus;
  if (isVerificationReply) {
    if (result.status === "verified_completed") {
      nextStatus = "completed";
    } else if (result.status === "blocked") {
      nextStatus = "blocked";
    } else {
      // Verification rejected the claim. Go back to queued so the loop can do
      // more real work — unless the agent has repeatedly claimed completion and
      // been rejected, in which case pause instead of burning the turn budget.
      nextStatus = rejectedClaims >= MAX_REJECTED_CLAIMS ? "paused" : "queued";
    }
  } else {
    if (result.status === "completed") {
      // A completion claim must pass an independent verification turn.
      nextStatus = "verifying_completed";
    } else if (result.status === "blocked") {
      nextStatus = "blocked";
    } else {
      nextStatus = "queued";
    }
  }

  const verificationRejectedPause =
    verificationRejected && rejectedClaims >= MAX_REJECTED_CLAIMS;
  const reachedTurnLimit =
    !TERMINAL_STATUSES.includes(nextStatus) &&
    nextStatus !== "verifying_completed" &&
    loop.turnCount >= loop.maxTurns;
  // `turn_kind` describes the turn that is in flight or, when no turn is in
  // flight, the kind the loop will send next. Keeping it in step here is what
  // lets a pause during the verification phase resume back into it, while a
  // pause taken after a rejected verification still resumes as a goal turn.
  const nextTurnKind: GoalLoopTurnKind =
    nextStatus === "verifying_completed" ? "verification" : "goal";
  const applied = getDb()
    .prepare(
      `UPDATE goal_loops
      SET status = ?, turn_kind = ?, rejected_claims = ?, pause_requested = 0, last_message_id = ?, progress = ?,
           summary = ?, evidence = ?, blocked_reason = ?, error = ?, pause_reason = ?,
           revision = revision + 1, updated_at = ?
       WHERE id = ? AND status = 'running' AND revision = ? AND last_message_id IS ?`,
    )
    .run(
      reachedTurnLimit ? "paused" : loop.pauseRequested && !TERMINAL_STATUSES.includes(nextStatus) ? "paused" : nextStatus,
      nextTurnKind,
      rejectedClaims,
      assistant.info.id,
      JSON.stringify(progress),
      result.summary,
      result.evidence ?? "",
      result.status === "blocked" ? result.evidence ?? result.summary : "",
      reachedTurnLimit
        ? "最大ターン数に到達したため一時停止しました。"
        : verificationRejectedPause
        ? "完了宣言が検証で複数回拒否されたため一時停止しました。ゴールか acceptance を見直してください。"
        : "",
      reachedTurnLimit
        ? "turn_limit"
        : verificationRejectedPause
        ? "verification_rejected"
        : loop.pauseRequested && !TERMINAL_STATUSES.includes(nextStatus)
          ? "user"
          : "",
      now,
      loop.id,
      loop.revision,
      loop.lastMessageId,
    );
  // A pause/stop/manual send invalidates the revision while the transcript was
  // being read. In that case the old assistant result must be discarded.
  if (applied.changes === 0) return;

  // The loop is genuinely `completed` now. Trigger background memory
  // extraction (fire-and-forget) so durable facts are captured for reuse.
  if (nextStatus === "completed") {
    scheduleAutoExtractAfterGoalCompleted(loop);
  }
}

/**
 * A prompt we sent produced no usable reply (aborted turn, dropped request).
 * Without this the loop would sit in `running` forever, showing no progress.
 */
function expireStalledTurn(loop: GoalLoopDto): void {
  const started = loop.lastPromptAt ? Date.parse(loop.lastPromptAt) : NaN;
  if (!Number.isFinite(started) || Date.now() - started < TURN_TIMEOUT_MS) return;
  getDb()
    .prepare(
      `UPDATE goal_loops
       SET status = 'paused', pause_reason = 'turn_timeout', error = ?,
           revision = revision + 1, updated_at = ?
       WHERE id = ? AND status = 'running' AND revision = ?`,
    )
    .run(
      "応答が確認できないまま時間切れになったため一時停止しました。",
      new Date().toISOString(),
      loop.id,
      loop.revision,
    );
}

/**
 * A POST timeout/network error is ambiguous: OpenCode may have accepted the
 * prompt despite the client never receiving an acknowledgement. Never retry
 * this non-idempotent mutation or roll back its turn claim; pause for an
 * explicit user decision instead.
 */
function pauseAfterUnknownPromptDelivery(
  loop: GoalLoopDto,
  message: string,
): void {
  getDb()
    .prepare(
      `UPDATE goal_loops
       SET status = 'paused', pause_reason = 'unknown_delivery', error = ?,
           revision = revision + 1, updated_at = ?
       WHERE id = ? AND status = 'running' AND revision = ? AND last_message_id IS ?`,
    )
    .run(
      message,
      new Date().toISOString(),
      loop.id,
      loop.revision,
      loop.lastMessageId,
    );
}

/**
 * True when the loop is paused because a `prompt_async` POST gave no usable
 * acknowledgement. Reads the `pause_reason` column: matching on the Japanese
 * `error` text used to break as soon as a later resume reworded the message,
 * which silently re-queued the loop and duplicated a possibly in-flight prompt.
 * See docs/specs/goal-loop.md invariant I5.
 */
/**
 * The read boundary vanished from the transcript (a revert or prune removed it).
 * Pause instead of guessing which reply belongs to this turn.
 */
function pauseForLostBoundary(loop: GoalLoopDto): void {
  getDb()
    .prepare(
      `UPDATE goal_loops
       SET status = 'paused', pause_reason = 'boundary_lost', error = ?,
           revision = revision + 1, updated_at = ?
       WHERE id = ? AND status = 'running' AND revision = ? AND last_message_id IS ?`,
    )
    .run(
      "会話履歴の基準メッセージが見つからないため、結果の誤読を防いで一時停止しました。",
      new Date().toISOString(),
      loop.id,
      loop.revision,
      loop.lastMessageId,
    );
}

function isUnknownPromptDeliveryPause(loop: GoalLoopDto): boolean {
  return loop.status === "paused" && loop.pauseReason === "unknown_delivery";
}

function recoverAfterRejectedPrompt(
  loop: GoalLoopDto,
  kind: "goal" | "verification",
  err: unknown,
): void {
  const now = new Date().toISOString();
  const prefix =
    kind === "verification"
      ? "完了検証プロンプトは OpenCode に拒否されました"
      : "プロンプトは OpenCode に拒否されました";
  if (kind === "verification") {
    getDb()
      .prepare(
        `UPDATE goal_loops
         SET status = 'verifying_completed', last_prompt_at = NULL, error = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'running' AND revision = ? AND last_message_id IS ?`,
      )
      .run(promptErrorMessage(prefix, err), now, loop.id, loop.revision, loop.lastMessageId);
    return;
  }
  getDb()
    .prepare(
      `UPDATE goal_loops
       SET status = 'queued', turn_count = ?, last_prompt_at = NULL, error = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND status = 'running' AND revision = ? AND last_message_id IS ? AND turn_count = ?`,
    )
    .run(
      loop.turnCount - 1,
      promptErrorMessage(prefix, err),
      now,
      loop.id,
      loop.revision,
      loop.lastMessageId,
      loop.turnCount,
    );
}

async function processLoop(loop: GoalLoopDto): Promise<void> {
  if (TERMINAL_STATUSES.includes(loop.status)) return;
  const ws = getWorkspace(loop.workspaceId);
  if (!ws) return;
  // Check before the busy-status early return. An engine that stays "busy"
  // forever must not prevent the running-turn timeout from taking effect.
  if (loop.status === "running") expireStalledTurn(loop);
  const statuses = await retryTransientOpenCode(() =>
    ocServer<StatusMap>(ws.absolute_path, SESSION_STATUS_PATH, {
      timeoutMs: STATUS_TIMEOUT_MS,
    }),
  );
  const status = statuses[loop.sessionId];
  // A missing entry means "not tracked / not running" (same convention as
  // task-service), not "unknown". Requiring an explicit idle entry stalled
  // every loop at 0 turns because the engine omits idle sessions entirely.
  if (status && status.type !== "idle") return;

  let messages: MessageWithParts[];
  try {
    messages = await retryTransientOpenCode(() =>
      ocServer<MessageWithParts[]>(
        ws.absolute_path,
        sessionMessagePath(loop.sessionId),
        { timeoutMs: MESSAGE_TIMEOUT_MS },
      ),
    );
  } catch {
    // Do not treat a failed read as an empty, idle transcript: queued prompts
    // would otherwise be sent on top of an unseen user or loop turn.
    return;
  }

  if (loop.status === "running") {
    // Without a boundary we cannot attribute any reply to this turn, so stop
    // rather than risk consuming a pre-loop message as the result (I4).
    if (boundaryLost(messages, loop.lastMessageId)) {
      pauseForLostBoundary(loop);
      return;
    }
    const assistant = finalAssistantAfter(messages, loop.lastMessageId);
    const result = assistant ? extractGoalResult(assistant) : null;
    if (assistant && result) {
      applyAssistantResult(loop, assistant, result);
      return;
    }
    // No result payload yet: the turn may still be emitting steps. Only give up
    // once the transcript has been quiet long enough to prove the turn really
    // ended without one.
    if (assistant && transcriptIdleFor(messages, STRUCTURED_GRACE_MS)) {
      applyAssistantResult(loop, assistant, null);
      return;
    }
    expireStalledTurn(loop);
    return;
  }

  if (loop.status === "verifying_completed") {
    if (!transcriptIdleFor(messages, TURN_QUIET_MS)) return;
    const anchor = latestMessageId(messages);
    const now = new Date().toISOString();
    const claimed = getDb()
      .prepare(
        `UPDATE goal_loops
         SET status = 'running', turn_kind = 'verification', last_message_id = ?,
             last_prompt_at = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'verifying_completed' AND revision = ?`,
      )
      .run(anchor, now, now, loop.id, loop.revision);
    if (claimed.changes === 0) return;
    // Verification does not consume a turn slot, so `turn_count` is the number
    // of goal turns actually executed before this check.
    const verifyCounts = getDb()
      .prepare("SELECT turn_count, max_turns FROM goal_loops WHERE id = ?")
      .get(loop.id) as { turn_count: number; max_turns: number } | undefined;
    const body: Record<string, unknown> = {
      parts: [
        {
          type: "text",
          text: buildVerificationPrompt(
            loop,
            verifyCounts?.turn_count ?? loop.turnCount,
            verifyCounts?.max_turns ?? loop.maxTurns,
          ),
        },
      ],
    };
    if (loop.agent) body.agent = loop.agent;
    if (loop.providerID && loop.modelID) {
      body.model = { providerID: loop.providerID, modelID: loop.modelID };
    }
    if (loop.variant) body.variant = loop.variant;
    const verificationBody = prependCollaborationContext(
      body,
      await collaborationContextFor({
        workspaceId: loop.workspaceId,
        sessionId: loop.sessionId,
        directory: ws.absolute_path,
      }),
    );
    const claimedLoop = {
      ...loop,
      revision: loop.revision + 1,
      lastMessageId: anchor,
      turnKind: "verification" as const,
    };
    try {
      await ocServer(ws.absolute_path, sessionPromptAsyncPath(loop.sessionId), {
        method: "POST",
        body: verificationBody,
        timeoutMs: PROMPT_TIMEOUT_MS,
      });
    } catch (err) {
      if (isDefinitelyRejectedPrompt(err)) {
        recoverAfterRejectedPrompt(claimedLoop, "verification", err);
      } else {
        pauseAfterUnknownPromptDelivery(
          claimedLoop,
          promptErrorMessage(
            "完了検証プロンプトの送達を確認できないため、重複送信を防止して一時停止しました",
            err,
          ),
        );
      }
      return;
    }
    touchSessionActivity(loop.workspaceId, loop.sessionId, now);
    return;
  }

  if (loop.status !== "queued") return;
  // Never prompt on top of an in-flight turn (the task's initial prompt, or a
  // manual send that has not been observed yet).
  if (!transcriptIdleFor(messages, TURN_QUIET_MS)) return;
  // Re-read fresh state: processLoop may have incremented turn_count on a
  // previous tick before the assistant reply landed, and the DTO snapshot we
  // received can lag behind. Checking the stale value lets one extra prompt
  // slip through and breaks the maxTurns contract.
  const fresh = getDb()
    .prepare("SELECT status, turn_count, max_turns, revision FROM goal_loops WHERE id = ?")
    .get(loop.id) as
      | { status: GoalLoopStatus; turn_count: number; max_turns: number; revision: number }
      | undefined;
  const turnCount = fresh?.turn_count ?? loop.turnCount;
  const maxTurns = fresh?.max_turns ?? loop.maxTurns;
  // If we are genuinely out of turns with no turn in flight, pause. If a turn
  // is in flight (running or verifying_completed) let it finish; another tick
  // will handle the result. This also prevents a racing second tick from pausing
  // the loop right after the first tick claimed the last allowed turn.
  if (fresh?.status === "queued" && turnCount >= maxTurns) {
    getDb()
      .prepare(
        `UPDATE goal_loops
         SET status = 'paused', pause_reason = 'turn_limit', error = ?,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'queued' AND revision = ?`,
      )
      .run(
        "最大ターン数に到達したため一時停止しました。",
        new Date().toISOString(),
        loop.id,
        fresh?.revision ?? loop.revision,
      );
    return;
  }

  const now = new Date().toISOString();
  // Re-anchor the boundary on the current transcript tail so the reply to *this*
  // prompt is what we read back. The id captured at creation time points into
  // the middle of the task's initial turn.
  const promptBoundary = latestMessageId(messages);
  const claimed = getDb()
    .prepare(
      `UPDATE goal_loops
       SET status = 'running', turn_kind = 'goal', turn_count = turn_count + 1,
           last_message_id = ?, last_prompt_at = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND status = 'queued' AND revision = ? AND turn_count < max_turns`,
    )
    .run(promptBoundary, now, now, loop.id, loop.revision);
  // Another writer (pause/stop/manual send) won the race: do not send.
  if (claimed.changes === 0) return;
  // Do NOT send `format` (OutputFormatJsonSchema). This OpenCode build stores
  // the decoded class instance as a plain object and then fails to re-encode it
  // on read, so GET /session/{id}/message returns 400 for the whole session
  // ("Expected OutputFormatJsonSchema, got {...}") — one loop turn permanently
  // bricks the transcript. The prompt asks for a fenced JSON block instead.
  // `loop` is the pre-increment snapshot; the UPDATE above claimed turn
  // `turnCount + 1`, which is the turn this prompt actually runs.
  const promptText = buildGoalPromptWithMemory(loop, turnCount + 1, maxTurns);
  const body: Record<string, unknown> = {
    parts: [{ type: "text", text: promptText }],
  };
  if (loop.agent) body.agent = loop.agent;
  if (loop.providerID && loop.modelID) {
    body.model = { providerID: loop.providerID, modelID: loop.modelID };
  }
  if (loop.variant) body.variant = loop.variant;
  const goalBody = prependCollaborationContext(
    body,
    await collaborationContextFor({
      workspaceId: loop.workspaceId,
      sessionId: loop.sessionId,
      directory: ws.absolute_path,
    }),
  );
  const claimedLoop = {
    ...loop,
    revision: loop.revision + 1,
    turnCount: turnCount + 1,
    lastMessageId: promptBoundary,
    turnKind: "goal" as const,
  };
  try {
    await ocServer(ws.absolute_path, sessionPromptAsyncPath(loop.sessionId), {
        method: "POST",
        body: goalBody,
        timeoutMs: PROMPT_TIMEOUT_MS,
      });
  } catch (err) {
    if (isDefinitelyRejectedPrompt(err)) {
      recoverAfterRejectedPrompt(claimedLoop, "goal", err);
    } else {
      pauseAfterUnknownPromptDelivery(
        claimedLoop,
        promptErrorMessage(
          "プロンプトの送達を確認できないため、重複送信を防止して一時停止しました",
          err,
        ),
      );
    }
    return;
  }
  touchSessionActivity(loop.workspaceId, loop.sessionId, now);
}

export async function runGoalLoopSchedulerTick(): Promise<void> {
  if (schedulerTicking) return;
  schedulerTicking = true;
  try {
    // Background memory extraction for sessions that went idle (fire-and-forget).
    sweepIdleExtractions();
    const loops = listRunnableGoalLoops();
    for (const loop of loops) {
      try {
        await processLoop(loop);
      } catch (err) {
        const message = err instanceof Error ? err.message : "ループでエラーが発生しました。";
        getDb()
          .prepare(
            `UPDATE goal_loops
             SET status = 'paused', pause_reason = 'scheduler_error', error = ?,
                 revision = revision + 1, updated_at = ?
             WHERE id = ? AND revision = ? AND status IN ('queued', 'running', 'verifying_completed')`,
          )
          // Slice on grapheme clusters so a 4000-char cut does not split a
          // surrogate pair (emoji/CJK) and garble the error string.
          .run(
            Array.from(message).slice(0, 4000).join(""),
            new Date().toISOString(),
            loop.id,
            loop.revision,
          );
      }
    }
  } finally {
    schedulerTicking = false;
  }
}

/** Exported for tests only. Resets the scheduler lock without clearing the timer. */
export function resetSchedulerTickingForTest(): void {
  schedulerTicking = false;
}

export function startGoalLoopScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  schedulerTimer = setInterval(() => void runGoalLoopSchedulerTick(), SCHEDULER_INTERVAL_MS);
  schedulerTimer.unref?.();
  void runGoalLoopSchedulerTick();
}

export function stopGoalLoopSchedulerForTest(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  schedulerStarted = false;
  schedulerTicking = false;
}

export const goalLoopTestSeams = {
  buildGoalPrompt,
  buildGoalPromptWithMemory,
  buildVerificationPrompt,
  normalizeAcceptance,
  normalizeStructured,
  latestMessageId,
  finalAssistantAfter,
  boundaryLost,
  transcriptIdleFor,
  extractGoalResult,
  deliveredGoalResultAfterUnknownPrompt,
  processLoop,
  applyAssistantResult,
  isTransientOpenCodeError,
  isTransientConflictPrompt,
  isDefinitelyRejectedPrompt,
  retryTransientOpenCode,
};
