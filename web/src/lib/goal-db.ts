import {
  getDb,
  getWorkspace,
  listSessionBindings,
  touchSessionActivity,
} from "./db";
import { OcError, ocServer, unwrapOcData } from "./oc-server";
import { assertSafeOpenCodeSessionId } from "./opencode-id";
import { activeInterruptPath, activeSessionMessagePath } from "./opencode-paths";
import {
  applyAssistantResult,
  deliveredGoalResultAfterUnknownPrompt,
  isUnknownPromptDeliveryPause,
} from "./goal-state";
import { runGoalLoopSchedulerTick } from "./goal-scheduler";
import {
  ABORT_TIMEOUT_MS,
  MAX_GOAL_CHARS,
  MESSAGE_TIMEOUT_MS,
  latestMessageId,
  normalizeAcceptance,
  toDto,
  type GoalLoopDto,
  type GoalLoopRow,
  type GoalLoopStatus,
} from "./goal-util";
import { isIntelligenceVariant } from "./model-variants";
import type { MessageWithParts } from "./types";

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

function normalizeForceFullRun(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export async function createGoalLoop(input: {
  workspaceId: string;
  sessionId: string;
  goal: string;
  acceptance?: unknown;
  maxTurns?: unknown;
  /** 完走モード。省略時 false（既定 OFF）。 */
  forceFullRun?: unknown;
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
  const forceFullRun = normalizeForceFullRun(input.forceFullRun);
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
    const raw = await ocServer<unknown>(
      ws.absolute_path,
      activeSessionMessagePath(input.sessionId),
      { timeoutMs: MESSAGE_TIMEOUT_MS },
    );
    // v2 message endpoints wrap the list in `{ data: [...] }`.
    messages = unwrapOcData<MessageWithParts>(raw);
  } catch {
    // A missing transcript cannot prove that the session is idle. Start paused
    // rather than treating it as [] and potentially sending over an unseen turn.
    transcriptReadable = false;
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  // The loop this create replaces. If it has an in-flight turn it must be
  // aborted, not just marked stopped: the engine would otherwise keep working
  // on the old goal, and the new loop would then wait for those stale turns to
  // finish before its first prompt (BR-26).
  const previous = getGoalLoop(input.workspaceId);
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
           force_full_run, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        forceFullRun ? 1 : 0,
        now,
        now,
      );
  });
  tx();
  touchSessionActivity(input.workspaceId, input.sessionId, now);
  if (previous && (previous.status === "running" || previous.status === "verifying_completed")) {
    // Best-effort, same courtesy as the user pause / stop paths. The row is
    // already `stopped`, so a late result cannot apply; the abort only stops
    // the engine from doing stale work on the replaced loop.
    await ocServer(ws.absolute_path, activeInterruptPath(previous.sessionId), {
      method: "POST",
      timeoutMs: ABORT_TIMEOUT_MS,
    }).catch(() => undefined);
  }
  if (transcriptReadable) void runGoalLoopSchedulerTick();
  return getGoalLoop(input.workspaceId)!;
}

export async function updateGoalLoopStatus(
  workspaceId: string,
  action: "pause" | "resume" | "stop" | "finish",
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
        await ocServer(ws.absolute_path, activeInterruptPath(loop.sessionId), {
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
      const raw = await ocServer<unknown>(
        ws.absolute_path,
        activeSessionMessagePath(loop.sessionId),
        { timeoutMs: MESSAGE_TIMEOUT_MS },
      );
      // v2 message endpoints wrap the list in `{ data: [...] }`.
      messages = unwrapOcData<MessageWithParts>(raw);
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
    // Recover a delivered-but-unapplied turn result. The original scope was
    // `unknown_delivery` pauses (the prompt may have reached OpenCode before
    // the client timed out), but user and manual_send pauses have the same
    // window: the reply lands on the transcript between the scheduler's ticks
    // (up to SCHEDULER_INTERVAL_MS), and a pause taken in that window used to
    // re-anchor past it, silently discarding the turn's progress and any
    // completion claim (BR-23, BR-24). Any other pause reason has no unapplied
    // reply to recover (results are applied before those pauses fire).
    const recovered =
      isUnknownPromptDeliveryPause(loop) ||
      loop.pauseReason === "user" ||
      loop.pauseReason === "manual_send"
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
    // `finish` はユーザーがループを手動で片付ける操作。まだ生きていれば `stop`
    // と同じく停止させ、加えてパネルを閉じる。既に終了しているループには
    // `dismissed` だけを立てる。`MAX` は既に片付けたループを stop で
    // 表示に戻さないためのガード。
    const dismiss = action === "finish" ? 1 : 0;
    const stopped = getDb()
      .prepare(
        `UPDATE goal_loops
         SET status = 'stopped', dismissed = MAX(dismissed, ?),
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND status NOT IN ('completed', 'blocked', 'stopped')`,
      )
      .run(dismiss, now, loop.id, loop.revision);
    if (action === "finish" && stopped.changes === 0) {
      getDb()
        .prepare(
          `UPDATE goal_loops SET dismissed = 1, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND dismissed = 0`,
        )
        .run(now, loop.id, loop.revision);
    }
    const ws = getWorkspace(workspaceId);
    if (ws && stopped.changes > 0) {
      await ocServer(ws.absolute_path, activeInterruptPath(loop.sessionId), {
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
      const raw = await ocServer<unknown>(
        ws.absolute_path,
        activeSessionMessagePath(loop.sessionId),
        { timeoutMs: MESSAGE_TIMEOUT_MS },
      );
      // v2 message endpoints wrap the list in `{ data: [...] }`.
      const messages = unwrapOcData<MessageWithParts>(raw);
      tailMessageId = latestMessageId(messages);
    } catch {
      // Still pause for the manual send, but retain the old boundary. A later
      // resume requires a successful fresh read before it can queue anything.
    }
  }
  const now = new Date().toISOString();
  const wasInFlight = loop.status === "running" || loop.status === "verifying_completed";
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
  if (MANUAL_SEND_PAUSABLE.includes(after.status)) return "conflict";
  // Abort the in-flight turn after the loop is parked, like the user pause
  // path. Without it the engine keeps processing the loop's turn while the
  // caller's manual prompt is forwarded, and the engine answers the prompt
  // with SessionBusy (409) because it is still busy (BR-26).
  if (wasInFlight && ws) {
    await ocServer(ws.absolute_path, activeInterruptPath(loop.sessionId), {
      method: "POST",
      timeoutMs: ABORT_TIMEOUT_MS,
    }).catch(() => undefined);
  }
  return "paused";
}
