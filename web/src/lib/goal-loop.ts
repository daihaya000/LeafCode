import { getDb, getWorkspace, listSessionBindings, touchSessionActivity } from "./db";
import { isIntelligenceVariant, type IntelligenceVariant } from "./model-variants";
import { OcError, ocServer } from "./oc-server";
import { assertSafeOpenCodeSessionId } from "./opencode-id";
import type { MessageWithParts, SessionStatus } from "./types";

export type GoalLoopStatus =
  | "queued"
  | "running"
  | "paused"
  | "verifying_completed"
  | "completed"
  | "blocked"
  | "stopped"
  | "error";

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
  created_at: string;
  updated_at: string;
};

type StatusMap = Record<string, SessionStatus>;

const TERMINAL_STATUSES: GoalLoopStatus[] = ["completed", "blocked", "stopped", "error"];
const SCHEDULER_INTERVAL_MS = 2_500;
/**
 * `prompt_async` normally returns 202 immediately, but under engine load the
 * prompt construction can take longer. 60s was too tight and surfaced raw
 * "The operation was aborted due to timeout" errors on busy loops; give room
 * up to the BFF's long-running mutation ceiling (290s) so a legitimate prompt
 * is not aborted mid-send.
 */
const PROMPT_TIMEOUT_MS = 120_000;
const STATUS_TIMEOUT_MS = 5_000;
const MESSAGE_TIMEOUT_MS = 10_000;
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
      `/session/${input.sessionId}/message`,
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
           last_message_id, agent, provider_id, model_id, variant, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    getDb()
      .prepare(
        `UPDATE goal_loops SET status = 'paused', revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND status IN ('queued', 'running', 'verifying_completed')`,
      )
      .run(now, loop.id, loop.revision);
  } else if (action === "resume") {
    // Re-anchor the read boundary to the current transcript tail so any
    // messages that arrived while paused (e.g. a manual user send) are not
    // mistaken for the loop's own turn result on the next tick.
    const ws = getWorkspace(workspaceId);
    let tailMessageId: string | null;
    try {
      if (!ws) throw new Error("workspace missing");
      const messages = await ocServer<MessageWithParts[]>(
        ws.absolute_path,
        `/session/${loop.sessionId}/message`,
        { timeoutMs: MESSAGE_TIMEOUT_MS },
      );
      tailMessageId = latestMessageId(messages);
    } catch {
      // Do not resume to queued without a fresh transcript boundary: an empty
      // fallback could make the next tick layer a loop prompt over unseen work.
      getDb()
        .prepare(
          `UPDATE goal_loops SET error = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND status IN ('paused', 'error')`,
        )
        .run(
          "会話履歴を読めないため再開できません。重複送信を防止するため、接続回復後に再試行してください。",
          now,
          loop.id,
          loop.revision,
        );
      return getGoalLoop(workspaceId);
    }
    getDb()
      .prepare(
        `UPDATE goal_loops
         SET status = 'queued', error = '', last_message_id = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND status IN ('paused', 'error')`,
      )
      .run(tailMessageId, now, loop.id, loop.revision);
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
      `UPDATE goal_loops SET max_turns = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`,
    )
    .run(clamped, now, loop.id, loop.revision);
  return getGoalLoop(workspaceId);
}

export async function pauseGoalLoopForManualSend(
  workspaceId: string,
  sessionId: string,
): Promise<void> {
  const loop = getGoalLoop(workspaceId);
  if (!loop || loop.sessionId !== sessionId) return;
  const ws = getWorkspace(workspaceId);
  let tailMessageId = loop.lastMessageId;
  if (ws) {
    try {
      const messages = await ocServer<MessageWithParts[]>(
        ws.absolute_path,
        `/session/${loop.sessionId}/message`,
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
       SET status = 'paused', error = '手動送信が行われたため一時停止しました。',
           last_message_id = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND opencode_session_id = ? AND revision = ?
         AND status IN ('queued', 'running', 'verifying_completed')`,
    )
    .run(tailMessageId, now, workspaceId, sessionId, loop.revision);
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

/**
 * Count consecutive "agent claimed completed → verification rejected" pairs at
 * the tail of the progress log. Each pair is a `completed` entry immediately
 * followed by a non-`verified_completed` verification entry. Stops at the
 * first gap (e.g. a `progress` entry that reset the cycle).
 */
function countRecentRejectedClaims(progress: GoalLoopProgress[]): number {
  let count = 0;
  for (let i = progress.length - 1; i >= 1; i -= 2) {
    const claim = progress[i - 1];
    const verify = progress[i];
    if (
      claim?.status === "completed" &&
      verify &&
      verify.status !== "verified_completed"
    ) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
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
         SET status = 'paused', last_message_id = ?, error = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'running' AND revision = ? AND last_message_id IS ?`,
      )
      .run(
        assistant.info.id,
        "Goalループの結果JSONを読めなかったため一時停止しました。",
        now,
        loop.id,
        loop.revision,
        loop.lastMessageId,
      );
    return;
  }
  const progress = [...loop.progress, result].slice(-50);

  // Detect whether this reply is the verification turn for a previous completed claim.
  const lastProgress = loop.progress.at(-1);
  const isVerificationReply =
    loop.status === "running" && lastProgress?.status === "completed";
  let nextStatus: GoalLoopStatus;
  if (isVerificationReply) {
    if (result.status === "verified_completed") {
      nextStatus = "completed";
    } else if (result.status === "blocked") {
      nextStatus = "blocked";
    } else {
      // Verification rejected the claim or returned an unexpected status.
      // Go back to queued so the loop can do more real work — unless the agent
      // has repeatedly claimed completion and been rejected, in which case we
      // pause to avoid burning the rest of the turn budget on a verify loop.
      // `progress` includes the just-rejected result so the count reflects it.
      const rejectedPairs = countRecentRejectedClaims(progress);
      if (rejectedPairs >= MAX_REJECTED_CLAIMS) {
        nextStatus = "paused";
      } else {
        nextStatus = "queued";
      }
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
    isVerificationReply &&
    result.status !== "verified_completed" &&
    result.status !== "blocked" &&
    countRecentRejectedClaims(progress) >= MAX_REJECTED_CLAIMS;
  const reachedTurnLimit =
    !TERMINAL_STATUSES.includes(nextStatus) &&
    nextStatus !== "verifying_completed" &&
    loop.turnCount >= loop.maxTurns;
  const applied = getDb()
    .prepare(
      `UPDATE goal_loops
       SET status = ?, last_message_id = ?, progress = ?, summary = ?, evidence = ?,
           blocked_reason = ?, error = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND status = 'running' AND revision = ? AND last_message_id IS ?`,
    )
    .run(
      reachedTurnLimit ? "paused" : nextStatus,
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
      now,
      loop.id,
      loop.revision,
      loop.lastMessageId,
    );
  // A pause/stop/manual send invalidates the revision while the transcript was
  // being read. In that case the old assistant result must be discarded.
  if (applied.changes === 0) return;
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
      `UPDATE goal_loops SET status = 'paused', error = ?, revision = revision + 1, updated_at = ?
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
       SET status = 'paused', error = ?, revision = revision + 1, updated_at = ?
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

async function processLoop(loop: GoalLoopDto): Promise<void> {
  if (TERMINAL_STATUSES.includes(loop.status)) return;
  const ws = getWorkspace(loop.workspaceId);
  if (!ws) return;
  // Check before the busy-status early return. An engine that stays "busy"
  // forever must not prevent the running-turn timeout from taking effect.
  if (loop.status === "running") expireStalledTurn(loop);
  const statuses = await retryTransientOpenCode(() =>
    ocServer<StatusMap>(ws.absolute_path, "/session/status", {
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
        `/session/${loop.sessionId}/message`,
        { timeoutMs: MESSAGE_TIMEOUT_MS },
      ),
    );
  } catch {
    // Do not treat a failed read as an empty, idle transcript: queued prompts
    // would otherwise be sent on top of an unseen user or loop turn.
    return;
  }

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

  if (loop.status === "verifying_completed") {
    if (!transcriptIdleFor(messages, TURN_QUIET_MS)) return;
    const anchor = latestMessageId(messages);
    const now = new Date().toISOString();
    const claimed = getDb()
      .prepare(
        `UPDATE goal_loops
         SET status = 'running', last_message_id = ?, last_prompt_at = ?, revision = revision + 1, updated_at = ?
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
    const claimedLoop = { ...loop, revision: loop.revision + 1, lastMessageId: anchor };
    try {
      await ocServer(ws.absolute_path, `/session/${loop.sessionId}/prompt_async`, {
        method: "POST",
        body,
        timeoutMs: PROMPT_TIMEOUT_MS,
      });
    } catch {
      pauseAfterUnknownPromptDelivery(
        claimedLoop,
        "完了検証プロンプトの送達を確認できないため、重複送信を防止して一時停止しました。",
      );
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
         SET status = 'paused', error = ?, revision = revision + 1, updated_at = ?
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
       SET status = 'running', turn_count = turn_count + 1, last_message_id = ?,
           last_prompt_at = ?, revision = revision + 1, updated_at = ?
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
  const body: Record<string, unknown> = {
    parts: [{ type: "text", text: buildGoalPrompt(loop, turnCount + 1, maxTurns) }],
  };
  if (loop.agent) body.agent = loop.agent;
  if (loop.providerID && loop.modelID) {
    body.model = { providerID: loop.providerID, modelID: loop.modelID };
  }
  if (loop.variant) body.variant = loop.variant;
  const claimedLoop = {
    ...loop,
    revision: loop.revision + 1,
    turnCount: turnCount + 1,
    lastMessageId: promptBoundary,
  };
  try {
    await ocServer(ws.absolute_path, `/session/${loop.sessionId}/prompt_async`, {
        method: "POST",
        body,
        timeoutMs: PROMPT_TIMEOUT_MS,
      });
  } catch {
    pauseAfterUnknownPromptDelivery(
      claimedLoop,
      "プロンプトの送達を確認できないため、重複送信を防止して一時停止しました。",
    );
    return;
  }
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
            `UPDATE goal_loops
             SET status = 'paused', error = ?, revision = revision + 1, updated_at = ?
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
  buildVerificationPrompt,
  normalizeStructured,
  latestMessageId,
  finalAssistantAfter,
  transcriptIdleFor,
  extractGoalResult,
  processLoop,
  applyAssistantResult,
  countRecentRejectedClaims,
  isTransientOpenCodeError,
  retryTransientOpenCode,
};
