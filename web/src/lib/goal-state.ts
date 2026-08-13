import { getDb } from "./db";
import { scheduleAutoExtractAfterGoalCompleted } from "./goal-memory-hook";
import {
  GOAL_LOOP_PROMPT_MARKER,
  MAX_REJECTED_CLAIMS,
  TERMINAL_STATUSES,
  TURN_TIMEOUT_MS,
  boundaryStartIndex,
  promptErrorMessage,
  type GoalLoopDto,
  type GoalLoopProgress,
  type GoalLoopStatus,
  type GoalLoopTurnKind,
} from "./goal-util";
import type { MessageWithParts } from "./types";

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

export function normalizeStructured(value: unknown): GoalLoopProgress | null {
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
export function jsonObjectCandidates(text: string): string[] {
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

export function assistantText(message: MessageWithParts): string {
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
export function extractGoalResult(assistant: MessageWithParts): GoalLoopProgress | null {
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
export function expireStalledTurn(loop: GoalLoopDto): void {
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
export function pauseAfterUnknownPromptDelivery(
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
export function pauseForLostBoundary(loop: GoalLoopDto): void {
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

export function recoverAfterRejectedPrompt(
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
