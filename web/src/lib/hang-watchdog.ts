/**
 * Server-side hang watchdog.
 *
 * A session can keep its SSE connection alive while the active turn is stuck
 * (a detached shell process, a provider that never closes the stream…). The
 * previous implementation watched for this inside `useSessionStream`, which only
 * ran while the browser was showing that exact task and never covered the first
 * turn of a new task (that prompt is fired by `POST /api/tasks` server-side).
 *
 * This module owns detection and the single automatic resume instead, so both
 * survive navigating away, closing the tab, and restarting the WebUI.
 *
 * See docs/specs/hang-watchdog-server-side.md.
 */

import { getDb, getSetting } from "./db";
import { hasHangRetryMarker, markHangRetryBody } from "./hang-retry";
import {
  DEFAULT_HANG_TIMEOUT_MS,
  HANG_TIMEOUT_SETTING_KEY,
  clampHangTimeoutMs,
} from "./hang-timeout";
import { OcError, ocServer, unwrapOcData } from "./oc-server";
import {
  PERMISSION_LIST_PATH,
  QUESTION_LIST_PATH,
  SESSION_STATUS_PATH,
  activeInterruptPath,
  activeSessionMessagePath,
  sessionPermissionListPathV2,
  sessionQuestionListPathV2,
} from "./opencode-paths";
import type { MessageWithParts, SessionStatus } from "./types";

export const HANG_WATCHDOG_INTERVAL_MS = 15_000;
/**
 * Bodies larger than this are not persisted (a prompt may carry up to 10 images
 * × 10MB). Such a watch still stops a hung turn, it just cannot resume it.
 */
export const MAX_WATCH_BODY_BYTES = 2_000_000;
/**
 * Extra grace added after the first over-threshold confirmation, so a turn that
 * is streaming text without emitting new timestamps gets a second look before
 * it is treated as hung.
 */
export const HANG_CONFIRM_GRACE_MS = 30_000;

/**
 * Extra confirmation grace for a turn that has no user-visible response after
 * the configured hang threshold. This is deliberately much shorter than the
 * hang timeout but long enough to cover a normal step transition.
 */
export const SILENT_RESPONSE_GRACE_MS = 30_000;

const STATUS_TIMEOUT_MS = 5_000;
const MESSAGES_TIMEOUT_MS = 20_000;
const ABORT_TIMEOUT_MS = 10_000;
const PENDING_INPUT_TIMEOUT_MS = 5_000;

export type SessionHangWatchRow = {
  session_id: string;
  directory: string;
  request_path: string;
  request_body: string;
  request_timeout_ms: number;
  resume_allowed: number;
  started_at: number;
  last_progress_at: number;
  progress_fingerprint: string;
  retry_used: number;
  state: "armed" | "resolving";
  updated_at: number;
};

export type ArmHangWatchInput = {
  sessionId: string;
  directory: string;
  /** OpenCode path to re-POST on resume, e.g. `/session/{id}/prompt_async`. */
  requestPath: string;
  body: unknown;
  timeoutMs: number;
  startedAt?: number;
};

let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let watchdogStarted = false;
let watchdogTicking = false;
let idleWaitAttempts = 6;
let idleWaitIntervalMs = 1_000;

function logWatchdog(message: string, row: { session_id: string; directory: string }, error?: unknown): void {
  const detail = error instanceof Error ? ` (${error.message})` : "";
  // Never log the prompt body: it can contain secrets pasted by the user.
  console.log(
    `[hang-watchdog] ${message}${detail}`,
    JSON.stringify({ sessionId: row.session_id, directory: row.directory }),
  );
}

/** Active hang threshold, from the same `hang-timeout` setting the UI writes. */
export function hangTimeoutMs(): number {
  const raw = getSetting(HANG_TIMEOUT_SETTING_KEY);
  if (raw === null) return DEFAULT_HANG_TIMEOUT_MS;
  return clampHangTimeoutMs(Number(raw));
}

/**
 * Rough size of the parts of a prompt body that can actually be large (inline
 * data URLs and text). The remaining fields are small metadata.
 */
export function estimateWatchBodyBytes(body: unknown): number {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 0;
  const record = body as Record<string, unknown>;
  let total = 0;
  const addFrom = (entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const value = entry as Record<string, unknown>;
    for (const key of ["url", "uri", "text", "output"]) {
      const field = value[key];
      if (typeof field === "string") total += field.length;
    }
  };
  if (Array.isArray(record.parts)) {
    for (const part of record.parts) addFrom(part);
  }
  const prompt = record.prompt;
  if (prompt && typeof prompt === "object" && !Array.isArray(prompt)) {
    const files = (prompt as { files?: unknown }).files;
    if (Array.isArray(files)) for (const file of files) addFrom(file);
    addFrom(prompt);
  }
  return total;
}

/**
 * Arm (or re-arm) the watchdog for a session's newest turn. Safe to call from a
 * request path: every failure mode degrades to "no watchdog for this send".
 */
export function armHangWatch(input: ArmHangWatchInput): void {
  const sessionId = input.sessionId.trim();
  const directory = input.directory.trim();
  if (!sessionId || !directory || !input.requestPath) return;

  let resumeAllowed = estimateWatchBodyBytes(input.body) <= MAX_WATCH_BODY_BYTES;
  let serialized = "{}";
  if (resumeAllowed) {
    try {
      serialized = JSON.stringify(input.body ?? {}) ?? "{}";
      if (serialized.length > MAX_WATCH_BODY_BYTES) {
        resumeAllowed = false;
        serialized = "{}";
      }
    } catch {
      resumeAllowed = false;
      serialized = "{}";
    }
  }

  // A body the watchdog itself re-sent must not hand the session a second
  // resume budget.
  const preserveRetryBudget = hasHangRetryMarker(input.body);
  const startedAt = input.startedAt ?? Date.now();
  const timeoutMs = Number.isFinite(input.timeoutMs) ? Math.max(1_000, input.timeoutMs) : 60_000;

  try {
    getDb()
      .prepare(
        `INSERT INTO session_hang_watches (
           session_id, directory, request_path, request_body, request_timeout_ms,
           resume_allowed, started_at, last_progress_at, progress_fingerprint,
           retry_used, state, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 0, 'armed', ?)
         ON CONFLICT(session_id) DO UPDATE SET
           directory = excluded.directory,
           request_path = excluded.request_path,
           request_body = excluded.request_body,
           request_timeout_ms = excluded.request_timeout_ms,
           resume_allowed = excluded.resume_allowed,
           started_at = excluded.started_at,
           last_progress_at = excluded.last_progress_at,
           progress_fingerprint = '',
           retry_used = CASE WHEN ? = 1 THEN session_hang_watches.retry_used ELSE 0 END,
           state = 'armed',
           updated_at = excluded.updated_at`,
      )
      .run(
        sessionId,
        directory,
        input.requestPath,
        serialized,
        Math.round(timeoutMs),
        resumeAllowed ? 1 : 0,
        startedAt,
        startedAt,
        startedAt,
        preserveRetryBudget ? 1 : 0,
      );
  } catch (error) {
    logWatchdog("failed to arm", { session_id: sessionId, directory }, error);
  }
}

/** Drop the watch, e.g. when the send itself was rejected by the engine. */
export function disarmHangWatch(sessionId: string): void {
  if (!sessionId) return;
  try {
    getDb().prepare("DELETE FROM session_hang_watches WHERE session_id = ?").run(sessionId);
  } catch {
    // A missing table/db only means there is nothing to disarm.
  }
}

export function getHangWatch(sessionId: string): SessionHangWatchRow | null {
  const row = getDb()
    .prepare("SELECT * FROM session_hang_watches WHERE session_id = ?")
    .get(sessionId) as SessionHangWatchRow | undefined;
  return row ?? null;
}

export function listArmedHangWatches(): SessionHangWatchRow[] {
  return getDb()
    .prepare("SELECT * FROM session_hang_watches WHERE state = 'armed' ORDER BY started_at ASC")
    .all() as SessionHangWatchRow[];
}

/** A WebUI restart can leave a watch mid-resolve; put it back under watch. */
export function recoverInterruptedHangWatches(): void {
  try {
    getDb()
      .prepare("UPDATE session_hang_watches SET state = 'armed', updated_at = ? WHERE state = 'resolving'")
      .run(Date.now());
  } catch {
    // Nothing to recover when the table does not exist yet.
  }
}

function isBusy(status: SessionStatus | undefined): boolean {
  return status?.type === "busy" || status?.type === "retry";
}

/**
 * Clock skew allowance when matching `started_at` to the user message stamp.
 * The watch is armed a few moments before the engine records the user row.
 */
const WATCHED_USER_SKEW_MS = 5_000;

/**
 * Index of the user message that owns this watch: newest user at or after
 * `startedAt - skew`. The skew covers the engine stamping the user a few ms
 * before arm completed. If no matching user exists yet (transcript lag right
 * after send), returns -1 so early ticks do not bind to a previous turn.
 */
function watchedUserIndex(messages: MessageWithParts[], startedAt: number): number {
  const threshold = startedAt - WATCHED_USER_SKEW_MS;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.info.role !== "user") continue;
    const created = message.info.time?.created;
    if (typeof created !== "number" || created >= threshold) {
      return index;
    }
  }
  return -1;
}

/**
 * OpenCode finish reasons that end the user-visible turn. Intermediate agent
 * steps use `tool-calls` / similar and must not disband the watch alone.
 */
function isTerminalFinish(finish: unknown): boolean {
  return (
    finish === "stop" ||
    finish === "end-turn" ||
    finish === "length" ||
    finish === "content-filter"
  );
}

/**
 * The engine can briefly report `idle` between agent steps while a tool part
 * is still running. Do not discard a watch in that gap: the transcript is the
 * more reliable source for an in-flight command.
 */
function hasActiveTool(messages: MessageWithParts[], startedAt: number): boolean {
  const latestUserIndex = watchedUserIndex(messages, startedAt);
  // When the user row is not visible yet, still scan the full transcript so a
  // laggy message list cannot hide a running tool.
  const from = latestUserIndex < 0 ? 0 : latestUserIndex + 1;

  return messages.slice(from).some((message) =>
    (message.parts ?? []).some(
      (part) =>
        part.type === "tool" &&
        (part.state?.status === "running" || part.state?.status === "pending"),
    ),
  );
}

/**
 * Whether the watched turn produced an actual assistant response — including a
 * terminal `finish` without user-visible text (tool loops ending on stop).
 */
function hasAssistantResponse(messages: MessageWithParts[], startedAt: number): boolean {
  const latestUserIndex = watchedUserIndex(messages, startedAt);
  if (latestUserIndex < 0) return false;

  return messages.slice(latestUserIndex + 1).some((message) => {
    if (message.info.role !== "assistant") return false;
    if (message.info.error || message.info.structured !== undefined) return true;
    if (isTerminalFinish(message.info.finish)) return true;
    return (message.parts ?? []).some(
      (part) => part.type === "text" && typeof part.text === "string" && part.text.trim() !== "",
    );
  });
}

/**
 * Engine went idle and the transcript already has any assistant step for this
 * turn (text, tools, reasoning, step markers). Replaying the prompt would
 * restart finished work — including multi-step turns that completed without a
 * final text part, and turns whose status map stayed busy after finish.
 */
function hasWatchedTurnAssistantActivity(
  messages: MessageWithParts[],
  startedAt: number,
): boolean {
  const latestUserIndex = watchedUserIndex(messages, startedAt);
  if (latestUserIndex < 0) return false;
  return messages
    .slice(latestUserIndex + 1)
    .some((message) => message.info.role === "assistant");
}

type PendingRow = { id?: unknown; sessionID?: unknown };

/** OpenCode REST often wraps lists as `{ data: T[] }` instead of a bare array. */
function normalizePendingList(raw: unknown): PendingRow[] {
  if (Array.isArray(raw)) return raw as PendingRow[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)) {
    return (raw as { data: PendingRow[] }).data;
  }
  return [];
}

/**
 * A turn stalled on an unanswered `question` or `permission` prompt is not a
 * hang: the engine is correctly idle-waiting for the user, and no amount of
 * "resume the same request" will ever help. Without this check the watchdog
 * would abort the turn (and the pending question/permission with it) once the
 * hang threshold elapses, purely because the user has not answered yet.
 *
 * Checked against both the v1 (global) and v2 (session-scoped) endpoints,
 * since either may be the active API depending on the engine version. Any
 * single endpoint failing (404 on an older/newer engine) is treated as "no
 * pending request there" rather than failing the whole check.
 */
async function hasPendingUserInput(directory: string, sessionId: string): Promise<boolean> {
  const attempts: Array<{ path: string; sessionScoped: boolean }> = [
    { path: sessionPermissionListPathV2(sessionId), sessionScoped: true },
    { path: sessionQuestionListPathV2(sessionId), sessionScoped: true },
    { path: PERMISSION_LIST_PATH, sessionScoped: false },
    { path: QUESTION_LIST_PATH, sessionScoped: false },
  ];
  for (const attempt of attempts) {
    try {
      const raw = await ocServer<unknown>(directory, attempt.path, {
        timeoutMs: PENDING_INPUT_TIMEOUT_MS,
      });
      const rows = normalizePendingList(raw);
      const hasPending = attempt.sessionScoped
        ? rows.length > 0
        : rows.some((row) => String(row.sessionID ?? "") === sessionId);
      if (hasPending) return true;
    } catch {
      // Unreachable/unsupported endpoint on this engine version: keep checking
      // the others instead of assuming a hang.
    }
  }
  return false;
}

/** Newest timestamp anywhere in the transcript, in epoch milliseconds. */
export function latestActivityAt(messages: MessageWithParts[]): number {
  let latest = 0;
  const bump = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value) && value > latest) latest = value;
  };
  for (const message of messages) {
    bump(message.info.time?.created);
    bump(message.info.time?.completed);
    for (const part of message.parts) {
      bump(part.time?.start);
      bump(part.time?.end);
      bump(part.state?.time?.start);
      bump(part.state?.time?.end);
    }
  }
  return latest;
}

/**
 * Cheap "did anything change" signal. It catches progress that produces no new
 * timestamps, such as a long streaming text part.
 */
export function progressFingerprint(messages: MessageWithParts[]): string {
  let partCount = 0;
  let textLength = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      partCount += 1;
      if (typeof part.text === "string") textLength += part.text.length;
      const output = part.state?.output;
      if (typeof output === "string") textLength += output.length;
    }
  }
  return `${messages.length}:${partCount}:${textLength}`;
}

function recordProgress(sessionId: string, progressAt: number, fingerprint: string): void {
  getDb()
    .prepare(
      `UPDATE session_hang_watches
       SET last_progress_at = ?, progress_fingerprint = ?, updated_at = ?
       WHERE session_id = ?`,
    )
    .run(progressAt, fingerprint, Date.now(), sessionId);
}

function markResolving(sessionId: string): boolean {
  const info = getDb()
    .prepare(
      "UPDATE session_hang_watches SET state = 'resolving', updated_at = ? WHERE session_id = ? AND state = 'armed'",
    )
    .run(Date.now(), sessionId);
  return info.changes > 0;
}

function markArmed(sessionId: string): void {
  getDb()
    .prepare("UPDATE session_hang_watches SET state = 'armed', updated_at = ? WHERE session_id = ?")
    .run(Date.now(), sessionId);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitForIdle(directory: string, sessionId: string): Promise<boolean> {
  for (let attempt = 0; attempt < idleWaitAttempts; attempt += 1) {
    await sleep(idleWaitIntervalMs);
    try {
      const statuses = await ocServer<Record<string, SessionStatus>>(directory, SESSION_STATUS_PATH, {
        timeoutMs: STATUS_TIMEOUT_MS,
      });
      if (!isBusy(statuses?.[sessionId])) return true;
    } catch {
      // Treat an unreachable engine as "not confirmed idle" and retry.
    }
  }
  return false;
}

async function resolveHang(row: SessionHangWatchRow): Promise<void> {
  if (!markResolving(row.session_id)) return;
  logWatchdog("hang detected — stopping the turn", row);

  try {
    await ocServer(row.directory, activeInterruptPath(row.session_id), {
      method: "POST",
      timeoutMs: ABORT_TIMEOUT_MS,
    });
  } catch (error) {
    logWatchdog("abort failed", row, error);
  }

  if (!(await waitForIdle(row.directory, row.session_id))) {
    markArmed(row.session_id);
    logWatchdog("still busy after abort — will retry on a later tick", row);
    return;
  }

  if (row.retry_used === 1) {
    disarmHangWatch(row.session_id);
    logWatchdog("stopped without resuming (this turn was already resumed once)", row);
    return;
  }
  if (row.resume_allowed === 0) {
    disarmHangWatch(row.session_id);
    logWatchdog("stopped without resuming (request body was too large to store)", row);
    return;
  }

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(row.request_body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad body");
    body = parsed as Record<string, unknown>;
  } catch (error) {
    disarmHangWatch(row.session_id);
    logWatchdog("stopped without resuming (stored body unreadable)", row, error);
    return;
  }

  const now = Date.now();
  getDb()
    .prepare(
      `UPDATE session_hang_watches
       SET retry_used = 1, started_at = ?, last_progress_at = ?, progress_fingerprint = '',
           state = 'armed', updated_at = ?
       WHERE session_id = ?`,
    )
    .run(now, now, now, row.session_id);

  // `session.command` / `session.prompt` block until the turn finishes, so the
  // resume is fired without awaiting completion; a failed POST leaves the
  // session idle and the next tick drops the watch.
  void ocServer(row.directory, row.request_path, {
    method: "POST",
    body: markHangRetryBody(body),
    timeoutMs: row.request_timeout_ms,
  }).catch((error: unknown) => {
    logWatchdog("resume request failed", row, error);
  });
  logWatchdog("resumed the same request once", row);
}

async function evaluateWatch(
  row: SessionHangWatchRow,
  statuses: Record<string, SessionStatus>,
  timeoutMs: number,
): Promise<void> {
  let messages: MessageWithParts[] = [];
  if (!isBusy(statuses?.[row.session_id])) {
    // An idle turn can still be a silent provider response, or the engine can
    // briefly report idle between agent steps while a tool is still running.
    // Check the transcript before dropping the saved request in either case.
    try {
      const raw = await ocServer<unknown>(row.directory, activeSessionMessagePath(row.session_id), {
        timeoutMs: MESSAGES_TIMEOUT_MS,
      });
      messages = unwrapOcData<MessageWithParts>(raw);
      if (messages.length === 0) return;
    } catch (error) {
      if (error instanceof OcError && error.status === 404) {
        // The engine no longer knows this session (deleted from the timeline
        // or pruned while the watch was armed). There is no turn left to stop
        // or resume, so the watch is pointless — drop it instead of retrying
        // every tick forever.
        disarmHangWatch(row.session_id);
        logWatchdog("session no longer exists — dropping the watch", row, error);
        return;
      }
      logWatchdog("could not confirm a completed response — leaving the watch armed", row, error);
      return;
    }

    // Idle + no running tool means the engine has left the turn. Any assistant
    // step (including tool-only / finish:stop) is finished work — never
    // re-POST the prompt. Pure silence (no assistant yet) still falls through
    // to the inactivity threshold for the single automatic resume.
    if (!hasActiveTool(messages, row.started_at)) {
      if (
        hasWatchedTurnAssistantActivity(messages, row.started_at) ||
        hasAssistantResponse(messages, row.started_at)
      ) {
        disarmHangWatch(row.session_id);
        return;
      }
    }
  }

  const now = Date.now();
  if (now - row.last_progress_at < timeoutMs) return;

  if (messages.length === 0) {
    try {
      const raw = await ocServer<unknown>(row.directory, activeSessionMessagePath(row.session_id), {
        timeoutMs: MESSAGES_TIMEOUT_MS,
      });
      messages = unwrapOcData<MessageWithParts>(raw);
    } catch (error) {
      if (error instanceof OcError && error.status === 404) {
        disarmHangWatch(row.session_id);
        logWatchdog("session no longer exists — dropping the watch", row, error);
        return;
      }
      logWatchdog("could not confirm activity — leaving the watch armed", row, error);
      return;
    }
  }
  if (messages.length === 0) return;

  // `/session/status` can remain busy after the final assistant message is
  // already complete. At the inactivity threshold, the transcript is the
  // stronger terminal signal; otherwise a stale busy entry would abort and
  // replay a task that has already finished.
  const activeTool = hasActiveTool(messages, row.started_at);
  const assistantResponse = hasAssistantResponse(messages, row.started_at);
  const turnActivity = hasWatchedTurnAssistantActivity(messages, row.started_at);
  if (!activeTool && (assistantResponse || turnActivity)) {
    disarmHangWatch(row.session_id);
    return;
  }

  const fingerprint = progressFingerprint(messages);
  const activityAt = Math.max(latestActivityAt(messages), row.started_at);
  const fingerprintChanged =
    row.progress_fingerprint !== "" && row.progress_fingerprint !== fingerprint;

  if (fingerprintChanged || activityAt > row.last_progress_at) {
    recordProgress(row.session_id, Math.max(activityAt, fingerprintChanged ? now : 0), fingerprint);
    return;
  }

  if (row.progress_fingerprint === "") {
    // First over-threshold look: remember the shape of the transcript and check
    // again shortly, so a purely streaming turn is not mistaken for a hang.
    const confirmationGraceMs =
      !activeTool && !assistantResponse ? SILENT_RESPONSE_GRACE_MS : HANG_CONFIRM_GRACE_MS;
    recordProgress(row.session_id, now - timeoutMs + confirmationGraceMs, fingerprint);
    return;
  }

  if (now - activityAt < timeoutMs) return;

  if (await hasPendingUserInput(row.directory, row.session_id)) {
    // Waiting on the user, not hung. Push the clock forward so the next check
    // is another full timeout away instead of firing on every tick.
    recordProgress(row.session_id, now, fingerprint);
    logWatchdog("unanswered question/permission — not a hang, waiting for the user", row);
    return;
  }

  await resolveHang(row);
}

export async function runHangWatchdogTick(): Promise<void> {
  if (watchdogTicking) return;
  watchdogTicking = true;
  try {
    const watches = listArmedHangWatches();
    if (watches.length === 0) return;
    const timeoutMs = hangTimeoutMs();

    const byDirectory = new Map<string, SessionHangWatchRow[]>();
    for (const watch of watches) {
      const rows = byDirectory.get(watch.directory) ?? [];
      rows.push(watch);
      byDirectory.set(watch.directory, rows);
    }

    for (const [directory, rows] of byDirectory) {
      let statuses: Record<string, SessionStatus>;
      try {
        statuses = await ocServer<Record<string, SessionStatus>>(directory, SESSION_STATUS_PATH, {
          timeoutMs: STATUS_TIMEOUT_MS,
        });
      } catch {
        // Fail open: an engine restart must not be read as "every turn hung".
        continue;
      }
      for (const row of rows) {
        try {
          await evaluateWatch(row, statuses ?? {}, timeoutMs);
        } catch (error) {
          logWatchdog("evaluation failed", row, error);
        }
      }
    }
  } finally {
    watchdogTicking = false;
  }
}

export function startHangWatchdog(): void {
  if (watchdogStarted) return;
  watchdogStarted = true;
  recoverInterruptedHangWatches();
  watchdogTimer = setInterval(() => {
    void runHangWatchdogTick();
  }, HANG_WATCHDOG_INTERVAL_MS);
  void runHangWatchdogTick();
}

export function stopHangWatchdogForTests(): void {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;
  watchdogStarted = false;
  watchdogTicking = false;
}

export function setHangWatchdogIdleWaitForTests(attempts: number, intervalMs: number): void {
  idleWaitAttempts = attempts;
  idleWaitIntervalMs = intervalMs;
}
