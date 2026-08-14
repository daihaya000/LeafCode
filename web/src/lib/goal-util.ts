import type { IntelligenceVariant } from "./model-variants";
import type { MessageWithParts, SessionStatus } from "./types";
import { OcError } from "./oc-server";
import { isIntelligenceVariant, type ProviderModelMeta } from "./model-variants";
import { stripMemoryInjectionBlock } from "./memory-text";

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

export const GOAL_LOOP_PAUSE_REASONS = new Set<string>([
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

export function toPauseReason(value: unknown): GoalLoopPauseReason {
  return typeof value === "string" && GOAL_LOOP_PAUSE_REASONS.has(value)
    ? (value as GoalLoopPauseReason)
    : "";
}

export function toTurnKind(value: unknown): GoalLoopTurnKind {
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
  /**
   * 完走モード: 完了宣言・検証ターンを使わず、指定の maxTurns まで goal ターンを
   * 必ず回す。作成時のみ設定。既定 false。
   */
  forceFullRun: boolean;
  /**
   * ユーザーが手動で片付けたループ。行は残るがパネルは表示せず、稼働中扱いも
   * しない。終了したループのカードが消せず、新規ループの導線まで塞いでいた
   * 問題への対処。
   */
  dismissed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GoalLoopRow = {
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
  force_full_run: number;
  dismissed: number;
  created_at: string;
  updated_at: string;
};

export type StatusMap = Record<string, SessionStatus>;

export const TERMINAL_STATUSES: GoalLoopStatus[] = ["completed", "blocked", "stopped"];

/** Bound transient OpenCode failures so one scheduler tick never retries forever. */
const OPENCODE_RETRY_ATTEMPTS = 3;
const OPENCODE_RETRY_DELAY_MS = 100;
const MAX_ACCEPTANCE_ITEMS = 10;
const MAX_ACCEPTANCE_CHARS = 2_000;
export function transientOpenCodeStatus(err: unknown): number | null {
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
export function isTransientOpenCodeError(err: unknown): boolean {
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
export function isTransientConflictPrompt(err: unknown): boolean {
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
export function isDefinitelyRejectedPrompt(err: unknown): boolean {
  const status = transientOpenCodeStatus(err);
  return (
    status !== null &&
    status !== 408 &&
    !isTransientConflictPrompt(err) &&
    status >= 400 &&
    status <= 499
  );
}

export function promptErrorMessage(prefix: string, err: unknown): string {
  const detail = err instanceof Error ? err.message : "OpenCode がプロンプトを拒否しました。";
  return `${prefix}: ${Array.from(detail).slice(0, 3500).join("")}`;
}

export async function retryTransientOpenCode<T>(operation: () => Promise<T>): Promise<T> {
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

export type ProviderResponse = {
  all?: Array<{
    id?: string;
    models?: Record<string, ProviderModelMeta>;
  }>;
};

export function providerModelsMap(response: ProviderResponse): Record<string, ProviderModelMeta> {
  const result: Record<string, ProviderModelMeta> = {};
  for (const provider of response.all ?? []) {
    if (!provider.id || !provider.models) continue;
    for (const [modelId, model] of Object.entries(provider.models)) {
      result[`${provider.id}::${modelId}`] = model;
    }
  }
  return result;
}

export type GoalLoopCompactionResult = "not_needed" | "compacted" | "conflict" | "retry";

function safeJsonArray<T>(value: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

export function toDto(row: GoalLoopRow): GoalLoopDto {
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
    forceFullRun: (row.force_full_run ?? 0) === 1,
    dismissed: (row.dismissed ?? 0) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeAcceptance(value: unknown): string[] | null {
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

export function latestMessageId(messages: MessageWithParts[]): string | null {
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
export function finalAssistantAfter(
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
export function boundaryStartIndex(
  messages: MessageWithParts[],
  lastMessageId: string | null,
): number | null {
  if (!lastMessageId) return 0;
  const index = messages.findIndex((m) => m.info.id === lastMessageId);
  return index < 0 ? null : index + 1;
}

/** True when the loop has a read boundary that is no longer in the transcript. */
export function boundaryLost(messages: MessageWithParts[], lastMessageId: string | null): boolean {
  return boundaryStartIndex(messages, lastMessageId) === null;
}

/**
 * `/session/status` omits sessions the engine is not actively tracking, so it
 * cannot prove a turn ended. Fall back to the transcript: the last message must
 * be a completed assistant that has stayed quiet for `quietMs`. Consecutive
 * step messages are created within milliseconds of each other, so any real gap
 * means the turn is over.
 */
export function transcriptIdleFor(
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

export const SCHEDULER_INTERVAL_MS = 2_500;
/**
 * `prompt_async` normally returns 202 immediately, but under engine load the
 * prompt construction can take longer. 60s was too tight and surfaced raw
 * "The operation was aborted due to timeout" errors on busy loops, so allow
 * 120s. Still well under the BFF's long-running mutation ceiling (290s), and a
 * send that exceeds it pauses with `prompt_unknown` rather than double-sending.
 */
export const PROMPT_TIMEOUT_MS = 120_000;
export const STATUS_TIMEOUT_MS = 5_000;
export const MESSAGE_TIMEOUT_MS = 10_000;
export const COMPACT_TIMEOUT_MS = 30_000;
export const COMPACT_POLL_MS = 250;
export const COMPACT_LOCK_TTL_MS = 120_000;
/**
 * Aborting is a best-effort courtesy on the stop path. It must not inherit
 * PROMPT_TIMEOUT_MS: a wedged engine would then hold the stop request for two
 * minutes even though the loop row is already terminal.
 */
export const ABORT_TIMEOUT_MS = 10_000;
/** Transcript silence that proves a multi-step turn ended (steps are ms apart). */
export const TURN_QUIET_MS = 5_000;
/** Longer silence before declaring a finished turn had no structured result. */
export const STRUCTURED_GRACE_MS = 60_000;
/** A `running` turn with no readable reply after this long is paused. */
export const TURN_TIMEOUT_MS = 30 * 60_000;
export const MAX_GOAL_CHARS = 12_000;
/**
 * How many times an agent may claim `completed` and have the independent
 * verification turn reject it before we pause the loop. Without this cap the
 * agent can alternate claim→reject until maxTurns is exhausted, spending the
 * whole budget on verification round-trips instead of real work.
 */
export const MAX_REJECTED_CLAIMS = 2;
export const GOAL_LOOP_PROMPT_MARKER = "<!-- webui-goal-loop-prompt -->";

/**
 * True when a text belongs to a goal-loop internal prompt, even if
 * workspace-memory / collaboration-context blocks were prepended before the
 * marker by the sending path (`buildGoalPromptWithMemory`,
 * `prependCollaborationContext`). Those internal blocks are stripped first so
 * the marker stays findable wherever it sits in the prefix chain. Renderers
 * and title generation must use this instead of a raw `startsWith` on the
 * marker, which misses prefixed prompts and leaks them into the chat.
 */
export function isGoalLoopPromptText(text: string | null | undefined): boolean {
  return stripMemoryInjectionBlock(text ?? "").startsWith(GOAL_LOOP_PROMPT_MARKER);
}
