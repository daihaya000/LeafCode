/**
 * Auto-extraction hook for goal loops (docs/specs/memory-layer.md 「自動抽出」).
 *
 * Fired when a goal loop makes the transition → `completed` (goal-loop.md #9).
 * The extraction is background work (a throwaway OpenCode session), so it is
 * deliberately fire-and-forget: failures never block or stall the goal loop.
 * Gated by the `memory.auto_extract` setting (default on).
 */

import { getSetting } from "./db";
import { runMemoryExtraction } from "./memory-extract";
import type { GoalLoopDto } from "./goal-loop";

export const AUTO_EXTRACT_SETTING_KEY = "memory.auto_extract";

export function isAutoExtractEnabled(): boolean {
  try {
    return getSetting(AUTO_EXTRACT_SETTING_KEY) !== "0";
  } catch {
    // No usable settings layer (e.g. db mocked out in tests): default enabled.
    return true;
  }
}

/**
 * Kick off extraction for `loop` when it just finished. Returns immediately;
 * does not await the extraction session. Safe to call unconditionally per
 * transition — it runs exactly once per loop because the caller only invokes
 * it after the row actually updates to `completed`.
 */
export function scheduleAutoExtractAfterGoalCompleted(loop: GoalLoopDto): void {
  if (!isAutoExtractEnabled()) return;
  const { workspaceId, sessionId } = loop;
  if (!workspaceId || !sessionId) return;
  void runMemoryExtraction({ workspaceId, sessionId }).catch(() => {
    // Background extraction must never surface an error to the goal loop.
  });
}