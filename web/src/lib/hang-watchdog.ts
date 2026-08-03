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
import { ocServer } from "./oc-server";
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

const STATUS_TIMEOUT_MS = 5_000;
const MESSAGES_TIMEOUT_MS = 20_000;
const ABORT_TIMEOUT_MS = 10_000;

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
      const statuses = await ocServer<Record<string, SessionStatus>>(directory, "/session/status", {
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
    await ocServer(row.directory, `/session/${row.session_id}/abort`, {
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
  if (!isBusy(statuses?.[row.session_id])) {
    // The engine is no longer running this turn — nothing left to watch.
    disarmHangWatch(row.session_id);
    return;
  }

  const now = Date.now();
  if (now - row.last_progress_at < timeoutMs) return;

  let messages: MessageWithParts[];
  try {
    messages = await ocServer<MessageWithParts[]>(
      row.directory,
      `/session/${row.session_id}/message`,
      { timeoutMs: MESSAGES_TIMEOUT_MS },
    );
  } catch (error) {
    logWatchdog("could not confirm activity — leaving the watch armed", row, error);
    return;
  }
  if (!Array.isArray(messages)) return;

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
    recordProgress(row.session_id, now - timeoutMs + HANG_CONFIRM_GRACE_MS, fingerprint);
    return;
  }

  if (now - activityAt < timeoutMs) return;
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
        statuses = await ocServer<Record<string, SessionStatus>>(directory, "/session/status", {
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
