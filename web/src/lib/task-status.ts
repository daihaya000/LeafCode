import type { SessionStatus, TaskStatus } from "./types";

/**
 * Pure task-status derivation. Order matters: workspace lifecycle first, then
 * live session activity, then engine reachability, then working-tree changes.
 */
export function deriveTaskStatus(input: {
  workspaceStatus: string;
  hasBinding: boolean;
  sessionStatus?: SessionStatus;
  engineOk: boolean;
  filesChanged: number;
  /** Live goal loop keeps the task working between turns (engine idle gap). */
  goalLoopActive?: boolean;
}): TaskStatus {
  const {
    workspaceStatus,
    hasBinding,
    sessionStatus,
    engineOk,
    filesChanged,
    goalLoopActive = false,
  } = input;
  if (workspaceStatus === "orphaned") return "orphaned";
  // archived does not imply merged — a workspace may be archived without
  // being merged into another branch. Use a distinct status (R12#2).
  if (workspaceStatus === "archived") return "archived";
  if (sessionStatus && sessionStatus.type !== "idle") return "working";
  // A down engine wins over the loop check so the sidebar still signals a
  // problem: a loop cannot advance while the engine is unreachable.
  if (hasBinding && !engineOk) return "unknown";
  // A live goal loop is still advancing even when the engine reports idle
  // between turns (queued wait / verifying_completed). Without this the
  // sidebar dot flickered to idle/ready between loop turns.
  if (goalLoopActive) return "working";
  if (filesChanged > 0) return "ready";
  return "idle";
}
