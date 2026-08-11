/**
 * Auto-extraction hook for goal loops (docs/specs/memory-layer.md 「自動抽出」).
 *
 * Fired when a goal loop makes the transition → `completed` (goal-loop.md #9).
 * The extraction is background work (a throwaway OpenCode session), so it is
 * deliberately fire-and-forget: failures never block or stall the goal loop.
 * Gated by the `memory.auto_extract` setting (default on).
 */

import { getSetting } from "./db";
import { scheduleAssistantMemoryExtraction } from "./memory-auto-extract";
import { runMemoryExtraction } from "./memory-extract";
import {
  MEMORY_AUTO_EXTRACT_SETTING_KEY,
  MEMORY_WRITE_APPROVAL_SETTING_KEY,
} from "./memory-settings";
import type { GoalLoopDto } from "./goal-loop";

export { MEMORY_WRITE_APPROVAL_SETTING_KEY } from "./memory-settings";
export { MEMORY_AUTO_EXTRACT_SETTING_KEY } from "./memory-settings";
export { isMemoryWriteApprovalEnabled } from "./memory-write-gate";

export const AUTO_EXTRACT_SETTING_KEY = MEMORY_AUTO_EXTRACT_SETTING_KEY;

/**
 * When `true`, all memory writes (auto-extract, MCP `memory_add`, manual API
 * create) insert rows as `approved=0` candidates that surface for human
 * review. When `false` (default, Hermes-compatible), writes are approved
 * immediately and become eligible for injection. The gate is read at write
 * time so toggling it takes effect on the next extraction without a restart.
 */
export const WRITE_APPROVAL_SETTING_KEY = MEMORY_WRITE_APPROVAL_SETTING_KEY;

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
export function scheduleAutoExtractAfterGoalCompleted(
  loop: GoalLoopDto,
  assistantMessageId?: string,
): void {
  if (!isAutoExtractEnabled()) return;
  const { workspaceId, sessionId } = loop;
  if (!workspaceId || !sessionId) return;
  if (assistantMessageId) {
    scheduleAssistantMemoryExtraction({
      workspaceId,
      sessionId,
      assistantMessageId,
      trigger: "goal-completed",
      allowActiveGoalLoop: true,
    });
    return;
  }
  void runMemoryExtraction({ workspaceId, sessionId, trigger: "goal-completed" }).catch(() => {
    // Background extraction must never surface an error to the goal loop.
  });
}
