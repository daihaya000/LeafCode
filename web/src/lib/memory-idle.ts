/**
 * Idle-triggered memory extraction (docs/specs/memory-layer.md 「自動抽出」).
 *
 * The auto-extraction phase has two triggers: goal-loop `completed` (wired in
 * `goal-memory-hook.ts`) and detecting that a workspace session went idle for
 * 60 minutes. This module implements the idle path.
 *
 * Idle signal: `session_bindings.updated_at` is bumped by goal-loop transitions
 * and assistant activity (`touchSessionActivity`), so a binding whose
 * `updated_at` is older than `IDLE_THRESHOLD_MS` is treated as idle. The
 * periodic sweep (`sweepIdleExtractions`) is hosted on the existing goal-loop
 * scheduler tick so no second independent timer is needed.
 *
 * Dedup: each (workspace, session) pair is extracted at most once for its
 * lifetime via the `memory_idle_extracts` ledger, so a long-idle session is
 * not resubmitted on every tick.
 */

import { getDb, getWorkspace, isIdleExtracted, markIdleExtracted } from "./db";
import { runMemoryExtraction } from "./memory-extract";
import { isAutoExtractEnabled } from "./goal-memory-hook";

export const IDLE_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes
const inFlightIdleExtractions = new Set<string>();

export type SessionBindingRow = {
  workspaceId: string;
  sessionId: string;
  lastActivityMs: number;
  idleMs: number;
};

export function sessionBindingUpdatedAt(
  workspaceId: string,
  sessionId: string,
): number | null {
  const row = getDb()
    .prepare(
      `SELECT updated_at FROM session_bindings
       WHERE workspace_id = ? AND opencode_session_id = ?`,
    )
    .get(workspaceId, sessionId) as { updated_at: string } | undefined;
  if (!row) return null;
  const ms = new Date(row.updated_at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Sessions whose last activity is older than `thresholdMs`. */
export function idleSessionsSince(
  nowMs: number,
  thresholdMs: number = IDLE_THRESHOLD_MS,
): SessionBindingRow[] {
  const rows = getDb()
    .prepare("SELECT workspace_id, opencode_session_id, updated_at FROM session_bindings")
    .all() as { workspace_id: string; opencode_session_id: string; updated_at: string }[];
  const cutoff = nowMs - thresholdMs;
  const idle: SessionBindingRow[] = [];
  for (const row of rows) {
    const lastMs = new Date(row.updated_at).getTime();
    if (!Number.isFinite(lastMs)) continue;
    if (lastMs <= cutoff) {
      idle.push({
        workspaceId: row.workspace_id,
        sessionId: row.opencode_session_id,
        lastActivityMs: lastMs,
        idleMs: nowMs - lastMs,
      });
    }
  }
  return idle;
}

/**
 * Launch extraction for an idle session. A process-local in-flight guard avoids
 * duplicate scheduler launches; the durable ledger is written only on success.
 */
function launchIdleExtraction(row: SessionBindingRow): boolean {
  if (!getWorkspace(row.workspaceId)) return false;
  const key = `${row.workspaceId}\u0000${row.sessionId}`;
  if (inFlightIdleExtractions.has(key)) return false;
  inFlightIdleExtractions.add(key);
  void runMemoryExtraction({
    workspaceId: row.workspaceId,
    sessionId: row.sessionId,
  })
    .then((result) => {
      if (!result.error) markIdleExtracted(row.workspaceId, row.sessionId);
    })
    .catch(() => {
      // A later sweep retries failed background extractions.
    })
    .finally(() => {
      inFlightIdleExtractions.delete(key);
    });
  return true;
}

/**
 * Sweep every bound session idle past the threshold and not yet successfully extracted.
 * Returns the number of extractions launched this tick. Gated by the
 * `memory.auto_extract` setting (shared with the goal-completed hook).
 */
export function sweepIdleExtractions(
  nowMs: number = Date.now(),
  thresholdMs: number = IDLE_THRESHOLD_MS,
): number {
  if (!isAutoExtractEnabled()) return 0;
  let launched = 0;
  for (const row of idleSessionsSince(nowMs, thresholdMs)) {
    try {
      if (isIdleExtracted(row.workspaceId, row.sessionId)) continue;
      if (launchIdleExtraction(row)) launched += 1;
    } catch {
      // A ledger/read failure on one session must not stop the others.
    }
  }
  return launched;
}
