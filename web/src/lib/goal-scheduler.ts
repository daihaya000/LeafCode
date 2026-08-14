import {
  getDb,
  getWorkspace,
  touchSessionActivity,
} from "./db";
import {
  sweepIdleExtractions,
} from "./memory-idle";
import {
  ocServer,
  unwrapOcData,
} from "./oc-server";
import {
  SESSION_STATUS_PATH,
  activePromptPath,
  activeSessionMessagePath,
} from "./opencode-paths";
import {
  type MessageWithParts,
} from "./types";
import {
  TERMINAL_STATUSES,
  boundaryLost,
  finalAssistantAfter,
  isDefinitelyRejectedPrompt,
  isGoalLoopPromptText,
  isTransientConflictPrompt,
  isTransientOpenCodeError,
  latestMessageId,
  normalizeAcceptance,
  promptErrorMessage,
  retryTransientOpenCode,
  transcriptIdleFor,
  MESSAGE_TIMEOUT_MS,
  PROMPT_TIMEOUT_MS,
  SCHEDULER_INTERVAL_MS,
  STATUS_TIMEOUT_MS,
  STRUCTURED_GRACE_MS,
  type GoalLoopDto,
  type GoalLoopStatus,
  type StatusMap,
} from "./goal-util";
import {
  buildGoalContinuationPrompt,
  buildGoalPrompt,
  buildGoalPromptWithMemory,
  buildVerificationPrompt,
} from "./goal-prompt";
import {
  memoryInjectionFor,
} from "./memory";
import {
  applyAssistantResult,
  deliveredGoalResultAfterUnknownPrompt,
  expireStalledTurn,
  extractGoalResult,
  normalizeStructured,
  pauseAfterUnknownPromptDelivery,
  pauseForLostBoundary,
  recoverAfterRejectedPrompt,
} from "./goal-state";
import {
  listRunnableGoalLoops,
} from "./goal-db";
import {
  collaborationContextFor,
  prependCollaborationContext,
} from "./collaboration-context";

let schedulerStarted = false;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerTicking = false;

// Lazy reference to break the goal-loop <-> goal-scheduler module cycle.
let autoCompactGoalLoopRef: typeof import("./goal-loop").autoCompactGoalLoop | null = null;
async function getAutoCompactGoalLoop() {
  if (!autoCompactGoalLoopRef) {
    ({ autoCompactGoalLoop: autoCompactGoalLoopRef } = await import("./goal-loop"));
  }
  return autoCompactGoalLoopRef;
}
export async function processLoop(loop: GoalLoopDto): Promise<void> {
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
    // The engine-idle gate above proves no turn is in flight, so an unfinished
    // transcript tail (an aborted verification prompt, a mid-stream assistant)
    // is leftover from an interrupted turn, not live work. Waiting for a quiet
    // completed assistant that will never come stalls the loop forever (BR-22).
    const compactResult = await (await getAutoCompactGoalLoop())(
      loop,
      ws.absolute_path,
      messages,
    );
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
  // The engine-idle gate above proves no turn is in flight, so we must not hold
  // off on an unfinished transcript tail: an aborted/crashed turn leaves an
  // unanswered prompt (or a mid-stream assistant) at the tail, and waiting for
  // a quiet completed assistant that will never come stalls the loop forever
  // (BR-22). The busy-status check at the top of processLoop is the real guard
  // against layering a prompt over an in-flight turn.
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

  const compactResult = await (await getAutoCompactGoalLoop())(
    loop,
    ws.absolute_path,
    messages,
  );
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
        // Re-read the row's current revision before the CAS. `processLoop` bumps
        // the revision when it claims a turn, so an unexpected exception raised
        // after the claim (e.g. a DB error in touchSessionActivity) would
        // otherwise make the snapshot-revision UPDATE a no-op: the error went
        // unrecorded and the loop stayed `running`, silently re-failing every
        // tick (BR-30). Re-reading also avoids clobbering a pause/stop from
        // another writer, since the status predicate still applies.
        const current = getDb()
          .prepare("SELECT revision FROM goal_loops WHERE id = ?")
          .get(loop.id) as { revision: number } | undefined;
        if (!current) continue;
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
            current.revision,
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
  isGoalLoopPromptText,
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
