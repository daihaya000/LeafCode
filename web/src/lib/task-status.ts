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
  if (workspaceStatus === "archived") return "merged";
  if (sessionStatus && sessionStatus.type !== "idle") return "working";
  if (hasBinding && !engineOk) return "unknown";
  if (filesChanged > 0) return "ready";
  return "idle";
}
