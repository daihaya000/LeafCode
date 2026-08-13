import {
  getDb,
  getSetting,
  getWorkspace,
  markCollaborationSnapshotCompacted,
  releaseSessionCompactionLock,
  touchSessionActivity,
  tryAcquireSessionCompactionLock,
} from "./db";
import { computeContextUsage } from "./context-usage";
import {
  clampThreshold,
  DEFAULT_TOKEN_SAVING_THRESHOLD,
  isTokenSavingMode,
} from "./token-saving-settings";
import { sweepIdleExtractions } from "./memory-idle";
import {
} from "./model-variants";
import { OcError, ocServer } from "./oc-server";
import { assertSafeOpenCodeSessionId } from "./opencode-id";
import {
  SESSION_STATUS_PATH,
  activePromptPath,
  activeSessionMessagePath,
} from "./opencode-paths";
import type { MessageWithParts } from "./types";
import { unwrapOcData } from "./oc-server";
import {
  TERMINAL_STATUSES,
  boundaryLost,
  boundaryStartIndex,
  finalAssistantAfter,
  isDefinitelyRejectedPrompt,
  isTransientConflictPrompt,
  isTransientOpenCodeError,
  latestMessageId,
  normalizeAcceptance,
  promptErrorMessage,
  providerModelsMap,
  retryTransientOpenCode,
  transcriptIdleFor,
  type GoalLoopCompactionResult,
  type GoalLoopDto,
  type GoalLoopProgress,
  type GoalLoopStatus,
  type GoalLoopTurnKind,
  type ProviderResponse,
  COMPACT_LOCK_TTL_MS,
  COMPACT_POLL_MS,
  COMPACT_TIMEOUT_MS,
  GOAL_LOOP_PROMPT_MARKER,
  MAX_REJECTED_CLAIMS,
  MESSAGE_TIMEOUT_MS,
  PROMPT_TIMEOUT_MS,
  SCHEDULER_INTERVAL_MS,
  STATUS_TIMEOUT_MS,
  STRUCTURED_GRACE_MS,
  TURN_QUIET_MS,
  TURN_TIMEOUT_MS,
  type StatusMap,
} from "./goal-util";
export type {
  GoalLoopDto,
  GoalLoopPauseReason,
  GoalLoopProgress,
  GoalLoopStatus,
  GoalLoopTurnKind,
} from "./goal-util";
import {
  buildGoalContinuationPrompt,
  buildGoalPrompt,
  buildGoalPromptWithMemory,
  buildVerificationPrompt,
} from "./goal-prompt";
import { scheduleAutoExtractAfterGoalCompleted } from "./goal-memory-hook";
import { memoryInjectionFor } from "./memory";
import {
  listRunnableGoalLoops,
} from "./goal-db";
export {
  createGoalLoop,
  getGoalLoop,
  listRunnableGoalLoops,
  pauseGoalLoopForManualSend,
  updateGoalLoopMaxTurns,
  updateGoalLoopStatus,
} from "./goal-db";
export type { ManualSendPauseResult } from "./goal-db";
import {
  collaborationContextFor,
  prependCollaborationContext,
} from "./collaboration-context";

let schedulerStarted = false;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerTicking = false;

async function autoCompactGoalLoop(
  loop: GoalLoopDto,
  directory: string,
  messages: MessageWithParts[],
): Promise<GoalLoopCompactionResult> {
  const mode = getSetting("token-saving");
  if (!isTokenSavingMode(mode) || mode !== "auto") return "not_needed";

  let providers: ProviderResponse;
  try {
    providers = await retryTransientOpenCode(() =>
      ocServer<ProviderResponse>(directory, "/provider", { timeoutMs: STATUS_TIMEOUT_MS }),
    );
  } catch (err) {
    // Provider metadata is only a preflight read for optional auto-compact.
    // A temporary engine/network outage must not turn a queued loop into a
    // permanent pause before its first prompt; the next scheduler tick retries.
    if (isTransientOpenCodeError(err)) return "retry";
    throw err;
  }
  const usage = computeContextUsage(messages, providerModelsMap(providers));
  const threshold = clampThreshold(
    Number(getSetting("token-saving-threshold") ?? DEFAULT_TOKEN_SAVING_THRESHOLD),
  );
  if (!usage || usage.pct < threshold) return "not_needed";

  const ownerId = `goal-loop:${loop.id}`;
  if (!tryAcquireSessionCompactionLock(loop.sessionId, ownerId, Date.now(), COMPACT_LOCK_TTL_MS)) {
    return "conflict";
  }
  try {
    await ocServer(directory, `/api/session/${assertSafeOpenCodeSessionId(loop.sessionId)}/compact`, {
      method: "POST",
      body: {},
      timeoutMs: COMPACT_TIMEOUT_MS,
    });

    const deadline = Date.now() + COMPACT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, COMPACT_POLL_MS));
      const status = await retryTransientOpenCode(() =>
        ocServer<StatusMap>(directory, SESSION_STATUS_PATH, { timeoutMs: STATUS_TIMEOUT_MS }),
      );
      if (status[loop.sessionId] && status[loop.sessionId].type !== "idle") continue;
      const rawMessages = await retryTransientOpenCode(() =>
        ocServer<unknown>(directory, activeSessionMessagePath(loop.sessionId), {
          timeoutMs: MESSAGE_TIMEOUT_MS,
        }),
      );
      // v2 message endpoints wrap the list in `{ data: [...] }`.
      const currentMessages = unwrapOcData<MessageWithParts>(rawMessages);
      const currentUsage = computeContextUsage(currentMessages, providerModelsMap(providers));
      if (
        currentMessages.length < messages.length ||
        currentUsage === null ||
        currentUsage.used < usage.used
      ) {
        try {
          markCollaborationSnapshotCompacted(loop.workspaceId, loop.sessionId);
        } catch {
          // Context recovery remains best-effort if the local DB is unavailable.
        }
        return "compacted";
      }
    }
    throw new OcError("OpenCodeのコンテキスト圧縮完了を確認できませんでした。", 408);
  } finally {
    releaseSessionCompactionLock(loop.sessionId, ownerId);
  }
}


/**
 * Prefixes the full goal prompt with the approved-memory block on the very
 * first turn. Later turns use the compact continuation prompt so the fixed
 * rules do not get appended to the transcript repeatedly.
 */
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
export function deliveredGoalResultAfterUnknownPrompt(
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

export function applyAssistantResult(
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

  // Whether this reply answers the verification prompt is recorded on the row
  // when the prompt is claimed (`turn_kind`). It must not be inferred from the
  // tail of `progress`: after a pause/resume the status no longer says
  // "verifying" while the tail still reads `completed`, so a normal goal reply
  // was misread as a verification reply and a genuine completion claim could
  // never reach `completed`. See docs/specs/goal-loop.md invariant I6.
  const isVerificationReply = loop.status === "running" && loop.turnKind === "verification";
  // 完走モード: エージェントが completed を返しても進捗扱いに落とす（検証へ進まない）。
  const effectiveResult: GoalLoopProgress =
    loop.forceFullRun && !isVerificationReply && result.status === "completed"
      ? { ...result, status: "progress" }
      : result;
  const progress = [...loop.progress, effectiveResult].slice(-50);

  // Running count of rejected completion claims. A counter column is used
  // instead of pairing entries at the tail of `progress`: any real work turn
  // between two rejections broke the pairing, so the cap never fired in the
  // case it exists for. See docs/specs/goal-loop.md 是正 E.
  const verificationRejected =
    isVerificationReply &&
    effectiveResult.status !== "verified_completed" &&
    effectiveResult.status !== "blocked";
  const rejectedClaims = verificationRejected
    ? loop.rejectedClaims + 1
    : isVerificationReply && effectiveResult.status === "verified_completed"
    ? 0
    : loop.rejectedClaims;
  let nextStatus: GoalLoopStatus;
  if (isVerificationReply) {
    if (effectiveResult.status === "verified_completed") {
      nextStatus = "completed";
    } else if (effectiveResult.status === "blocked") {
      nextStatus = "blocked";
    } else {
      // Verification rejected the claim. Go back to queued so the loop can do
      // more real work — unless the agent has repeatedly claimed completion and
      // been rejected, in which case pause instead of burning the turn budget.
      nextStatus = rejectedClaims >= MAX_REJECTED_CLAIMS ? "paused" : "queued";
    }
  } else {
    if (effectiveResult.status === "completed") {
      // A completion claim must pass an independent verification turn.
      nextStatus = "verifying_completed";
    } else if (effectiveResult.status === "blocked") {
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
      effectiveResult.summary,
      effectiveResult.evidence ?? "",
      effectiveResult.status === "blocked" ? effectiveResult.evidence ?? effectiveResult.summary : "",
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
  //
  // 完走モードは完了宣言を使わないので `completed` に到達しない。予定した
  // ターン数を走り切った時点が通常モードの完了に相当するため、そこで同じ
  // 抽出を回す。これがないと完走ループの全ターンが一度も回収されない
  // （ループ稼働中は通常の assistant-completed 抽出も抑止されるため）。
  if (nextStatus === "completed" || (reachedTurnLimit && loop.forceFullRun)) {
    scheduleAutoExtractAfterGoalCompleted(loop, assistant.info.id);
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

export function isUnknownPromptDeliveryPause(loop: GoalLoopDto): boolean {
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
  let statuses: StatusMap;
  try {
    statuses = await retryTransientOpenCode(() =>
      ocServer<StatusMap>(ws.absolute_path, SESSION_STATUS_PATH, {
        timeoutMs: STATUS_TIMEOUT_MS,
      }),
    );
  } catch (err) {
    // Status is a read-only scheduling hint. Keep the loop in its current
    // state when OpenCode is temporarily unreachable and let the next tick
    // retry instead of converting the outage into scheduler_error.
    if (isTransientOpenCodeError(err)) return;
    throw err;
  }
  const status = statuses[loop.sessionId];
  // A missing entry means "not tracked / not running" (same convention as
  // task-service), not "unknown". Requiring an explicit idle entry stalled
  // every loop at 0 turns because the engine omits idle sessions entirely.
  if (status && status.type !== "idle") return;

  let messages: MessageWithParts[];
  try {
    const raw = await retryTransientOpenCode(() =>
      ocServer<unknown>(
        ws.absolute_path,
        activeSessionMessagePath(loop.sessionId),
        { timeoutMs: MESSAGE_TIMEOUT_MS },
      ),
    );
    // v2 message endpoints wrap the list in `{ data: [...] }`.
    messages = unwrapOcData<MessageWithParts>(raw);
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
    const compactResult = await autoCompactGoalLoop(loop, ws.absolute_path, messages);
    if (compactResult === "conflict" || compactResult === "retry") {
      return;
    }
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
    const verificationPrompt = buildVerificationPrompt(
      loop,
      verifyCounts?.turn_count ?? loop.turnCount,
      verifyCounts?.max_turns ?? loop.maxTurns,
    );
    const memory =
      compactResult === "compacted" ? memoryInjectionFor(loop.workspaceId, loop.goal) : "";
    const body: Record<string, unknown> = {
      parts: [
        {
          type: "text",
          text: memory ? `${memory}\n${verificationPrompt}` : verificationPrompt,
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
      await ocServer(ws.absolute_path, activePromptPath(loop.sessionId), {
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

  const compactResult = await autoCompactGoalLoop(loop, ws.absolute_path, messages);
  if (compactResult === "conflict" || compactResult === "retry") {
    // Keep the loop queued. The next scheduler tick retries after the other
    // tab/process releases the session compaction lock or the engine recovers.
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
  const promptText = buildGoalPromptWithMemory(
    loop,
    turnCount + 1,
    maxTurns,
    compactResult === "compacted",
  );
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
    await ocServer(ws.absolute_path, activePromptPath(loop.sessionId), {
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
  buildGoalContinuationPrompt,
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
