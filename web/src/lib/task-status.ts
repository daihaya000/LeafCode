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
}): TaskStatus {
  const { workspaceStatus, hasBinding, sessionStatus, engineOk, filesChanged } =
    input;
  if (workspaceStatus === "orphaned") return "orphaned";
  // archived does not imply merged — a workspace may be archived without
  // being merged into another branch. Use a distinct status (R12#2).
  if (workspaceStatus === "archived") return "archived";
  if (sessionStatus && sessionStatus.type !== "idle") return "working";
  if (hasBinding && !engineOk) return "unknown";
  if (filesChanged > 0) return "ready";
  return "idle";
}
