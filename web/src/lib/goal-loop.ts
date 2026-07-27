import { getDb, getWorkspace, listSessionBindings, touchSessionActivity } from "./db";
import { isIntelligenceVariant, type IntelligenceVariant } from "./model-variants";
import { OcError, ocServer } from "./oc-server";
import { assertSafeOpenCodeSessionId } from "./opencode-id";
import type { MessageWithParts, SessionStatus } from "./types";

export type GoalLoopStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "blocked"
  | "stopped"
  | "error";

export type GoalLoopProgress = {
  time: string;
  status: "progress" | "completed" | "blocked";
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
  created_at: string;
  updated_at: string;
};

type StatusMap = Record<string, SessionStatus>;

const TERMINAL_STATUSES: GoalLoopStatus[] = ["completed", "blocked", "stopped", "error"];
const SCHEDULER_INTERVAL_MS = 2_500;
const PROMPT_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 5_000;
const MESSAGE_TIMEOUT_MS = 10_000;
/** Transcript silence that proves a multi-step turn ended (steps are ms apart). */
const TURN_QUIET_MS = 5_000;
/** Longer silence before declaring a finished turn had no structured result. */
const STRUCTURED_GRACE_MS = 60_000;
/** A `running` turn with no readable reply after this long is paused. */
const TURN_TIMEOUT_MS = 30 * 60_000;
const MAX_ACCEPTANCE_ITEMS = 10;
const MAX_GOAL_CHARS = 12_000;
const MAX_ACCEPTANCE_CHARS = 2_000;

let schedulerStarted = false;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerTicking = false;

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
  return out.slice(0, MAX_ACCEPTANCE_ITEMS);
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
 * only the last one carries the `structured` payload we asked for. Picking the
 * *first* assistant after the boundary therefore grabbed an intermediate step
 * and paused the loop with "structured result unreadable" on turn 1, so scan
 * backwards for the newest completed assistant instead.
 */
function finalAssistantAfter(
  messages: MessageWithParts[],
  lastMessageId: string | null,
): MessageWithParts | null {
  const start = lastMessageId
    ? Math.max(0, messages.findIndex((m) => m.info.id === lastMessageId) + 1)
    : 0;
  for (let i = messages.length - 1; i >= start; i -= 1) {
    const m = messages[i];
    if (m?.info.role === "assistant" && typeof m.info.time?.completed === "number") {
      return m;
    }
  }
  return null;
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
       WHERE status IN ('queued', 'running')
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
  const maxTurnsRaw = Number(input.maxTurns ?? 10);
  const maxTurns = Number.isInteger(maxTurnsRaw)
    ? Math.min(Math.max(maxTurnsRaw, 1), 100)
    : 10;
  const agent = typeof input.agent === "string" && input.agent.trim() ? input.agent.trim() : null;
  const model =
    input.model && typeof input.model === "object" && !Array.isArray(input.model)
      ? (input.model as Record<string, unknown>)
      : null;
  const providerID = typeof model?.providerID === "string" ? model.providerID : null;
  const modelID = typeof model?.modelID === "string" ? model.modelID : null;
  const variant = isIntelligenceVariant(input.variant) ? input.variant : null;

  const messages = await ocServer<MessageWithParts[]>(
    ws.absolute_path,
    `/session/${input.sessionId}/message`,
    { timeoutMs: MESSAGE_TIMEOUT_MS },
  ).catch(() => []);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const tx = getDb().transaction(() => {
    getDb()
      .prepare(
        `UPDATE goal_loops
         SET status = 'stopped', updated_at = ?
         WHERE workspace_id = ? AND status IN ('queued', 'running', 'paused')`,
      )
      .run(now, input.workspaceId);
    getDb()
      .prepare(
        `INSERT INTO goal_loops
          (id, workspace_id, opencode_session_id, status, goal, acceptance, max_turns,
           last_message_id, agent, provider_id, model_id, variant, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.sessionId,
        goal,
        JSON.stringify(acceptance),
        maxTurns,
        latestMessageId(messages),
        agent,
        providerID,
        modelID,
        variant,
        now,
        now,
      );
  });
  tx();
  touchSessionActivity(input.workspaceId, input.sessionId, now);
  void runGoalLoopSchedulerTick();
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
    getDb()
      .prepare(
        `UPDATE goal_loops SET status = 'paused', updated_at = ?
         WHERE id = ? AND status IN ('queued', 'running')`,
      )
      .run(now, loop.id);
  } else if (action === "resume") {
    getDb()
      .prepare(
        `UPDATE goal_loops SET status = 'queued', error = '', updated_at = ?
         WHERE id = ? AND status IN ('paused', 'error')`,
      )
      .run(now, loop.id);
    void runGoalLoopSchedulerTick();
  } else {
    getDb()
      .prepare(
        `UPDATE goal_loops SET status = 'stopped', updated_at = ?
         WHERE id = ? AND status NOT IN ('completed', 'blocked', 'stopped')`,
      )
      .run(now, loop.id);
    const ws = getWorkspace(workspaceId);
    if (ws) {
      await ocServer(ws.absolute_path, `/session/${loop.sessionId}/abort`, {
        method: "POST",
        timeoutMs: PROMPT_TIMEOUT_MS,
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
      `UPDATE goal_loops SET max_turns = ?, updated_at = ? WHERE id = ?`,
    )
    .run(clamped, now, loop.id);
  return getGoalLoop(workspaceId);
}

export function pauseGoalLoopForManualSend(workspaceId: string, sessionId: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE goal_loops
       SET status = 'paused', error = '手動送信が行われたため一時停止しました。', updated_at = ?
       WHERE workspace_id = ? AND opencode_session_id = ? AND status IN ('queued', 'running')`,
    )
    .run(now, workspaceId, sessionId);
}

function buildGoalPrompt(loop: GoalLoopDto): string {
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

Rules:
- Continue autonomously until the goal is completed, blocked, paused, or stopped by the WebUI.
- Do not ask the user questions unless truly blocked.
- Do not claim completion unless the goal and acceptance criteria are satisfied.
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
  if (status !== "progress" && status !== "completed" && status !== "blocked") {
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
) {
  const now = new Date().toISOString();
  if (!result) {
    getDb()
      .prepare(
        `UPDATE goal_loops
         SET status = 'paused', last_message_id = ?, error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(assistant.info.id, "Goalループの結果JSONを読めなかったため一時停止しました。", now, loop.id);
    return;
  }
  const progress = [...loop.progress, result].slice(-50);
  const terminal = result.status === "completed" || result.status === "blocked";
  const nextStatus: GoalLoopStatus =
    result.status === "completed" ? "completed" : result.status === "blocked" ? "blocked" : "queued";
  getDb()
    .prepare(
      `UPDATE goal_loops
       SET status = ?, last_message_id = ?, progress = ?, summary = ?, evidence = ?,
           blocked_reason = ?, error = '', updated_at = ?
       WHERE id = ?`,
    )
    .run(
      nextStatus,
      assistant.info.id,
      JSON.stringify(progress),
      result.summary,
      result.evidence ?? "",
      result.status === "blocked" ? result.evidence ?? result.summary : "",
      now,
      loop.id,
    );
  // Re-read turn_count from the DB so we don't act on the stale DTO snapshot
  // (processLoop already incremented it for this turn). Without this, the
  // maxTurns guard below would fire one turn late and oversend.
  if (!terminal) {
    const fresh = getDb()
      .prepare("SELECT turn_count, max_turns FROM goal_loops WHERE id = ?")
      .get(loop.id) as { turn_count: number; max_turns: number } | undefined;
    if (fresh && fresh.turn_count >= fresh.max_turns) {
      getDb()
        .prepare(
          `UPDATE goal_loops
           SET status = 'paused', error = ?, updated_at = ?
           WHERE id = ? AND status NOT IN ('completed', 'blocked', 'stopped')`,
        )
        .run("最大ターン数に到達したため一時停止しました。", now, loop.id);
    }
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
      `UPDATE goal_loops SET status = 'paused', error = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`,
    )
    .run(
      "応答が確認できないまま時間切れになったため一時停止しました。",
      new Date().toISOString(),
      loop.id,
    );
}

async function processLoop(loop: GoalLoopDto): Promise<void> {
  if (TERMINAL_STATUSES.includes(loop.status)) return;
  const ws = getWorkspace(loop.workspaceId);
  if (!ws) return;
  const statuses = await ocServer<StatusMap>(ws.absolute_path, "/session/status", {
    timeoutMs: STATUS_TIMEOUT_MS,
  });
  const status = statuses[loop.sessionId];
  // A missing entry means "not tracked / not running" (same convention as
  // task-service), not "unknown". Requiring an explicit idle entry stalled
  // every loop at 0 turns because the engine omits idle sessions entirely.
  if (status && status.type !== "idle") return;

  const messages = await ocServer<MessageWithParts[]>(
    ws.absolute_path,
    `/session/${loop.sessionId}/message`,
    { timeoutMs: MESSAGE_TIMEOUT_MS },
  ).catch(() => []);

  if (loop.status === "running") {
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

  if (loop.status !== "queued") return;
  // Never prompt on top of an in-flight turn (the task's initial prompt, or a
  // manual send that has not been observed yet).
  if (!transcriptIdleFor(messages, TURN_QUIET_MS)) return;
  // Re-read turn_count from the DB: processLoop may have incremented it on a
  // previous tick before the assistant reply landed, and the DTO snapshot we
  // received can lag behind. Checking the stale value lets one extra prompt
  // slip through and breaks the maxTurns contract.
  const freshCounts = getDb()
    .prepare("SELECT turn_count, max_turns FROM goal_loops WHERE id = ?")
    .get(loop.id) as { turn_count: number; max_turns: number } | undefined;
  const turnCount = freshCounts?.turn_count ?? loop.turnCount;
  const maxTurns = freshCounts?.max_turns ?? loop.maxTurns;
  if (turnCount >= maxTurns) {
    getDb()
      .prepare(
        `UPDATE goal_loops SET status = 'paused', error = ?, updated_at = ? WHERE id = ?`,
      )
      .run("最大ターン数に到達したため一時停止しました。", new Date().toISOString(), loop.id);
    return;
  }

  const now = new Date().toISOString();
  // Re-anchor the boundary on the current transcript tail so the reply to *this*
  // prompt is what we read back. The id captured at creation time points into
  // the middle of the task's initial turn.
  const claimed = getDb()
    .prepare(
      `UPDATE goal_loops
       SET status = 'running', turn_count = turn_count + 1, last_message_id = ?,
           last_prompt_at = ?, updated_at = ?
       WHERE id = ? AND status = 'queued'`,
    )
    .run(latestMessageId(messages), now, now, loop.id);
  // Another writer (pause/stop/manual send) won the race: do not send.
  if (claimed.changes === 0) return;
  // Do NOT send `format` (OutputFormatJsonSchema). This OpenCode build stores
  // the decoded class instance as a plain object and then fails to re-encode it
  // on read, so GET /session/{id}/message returns 400 for the whole session
  // ("Expected OutputFormatJsonSchema, got {...}") — one loop turn permanently
  // bricks the transcript. The prompt asks for a fenced JSON block instead.
  const body: Record<string, unknown> = {
    parts: [{ type: "text", text: buildGoalPrompt(loop) }],
  };
  if (loop.agent) body.agent = loop.agent;
  if (loop.providerID && loop.modelID) {
    body.model = { providerID: loop.providerID, modelID: loop.modelID };
  }
  if (loop.variant) body.variant = loop.variant;
  await ocServer(ws.absolute_path, `/session/${loop.sessionId}/prompt_async`, {
    method: "POST",
    body,
    timeoutMs: PROMPT_TIMEOUT_MS,
  });
  touchSessionActivity(loop.workspaceId, loop.sessionId, now);
}

export async function runGoalLoopSchedulerTick(): Promise<void> {
  if (schedulerTicking) return;
  schedulerTicking = true;
  try {
    const loops = listRunnableGoalLoops();
    for (const loop of loops) {
      try {
        await processLoop(loop);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Goalループでエラーが発生しました。";
        getDb()
          .prepare(
            `UPDATE goal_loops SET status = 'error', error = ?, updated_at = ? WHERE id = ?`,
          )
          .run(message.slice(0, 4000), new Date().toISOString(), loop.id);
      }
    }
  } finally {
    schedulerTicking = false;
  }
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
  normalizeStructured,
  latestMessageId,
  finalAssistantAfter,
  transcriptIdleFor,
  extractGoalResult,
};
