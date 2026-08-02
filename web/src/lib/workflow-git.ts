import { createHash } from "node:crypto";
import { runGit } from "./git";

export type WorkflowWorkspaceSnapshot = {
  head: string | null;
  fingerprint: string;
  changedFiles: string[];
};

export async function readWorkflowWorkspaceSnapshot(
  directory: string,
): Promise<WorkflowWorkspaceSnapshot> {
  const [headResult, statusResult] = await Promise.all([
    runGit(directory, ["rev-parse", "HEAD"]),
    runGit(directory, ["status", "--porcelain=v1", "--untracked-files=all"]),
  ]);
  const head = headResult.code === 0 ? headResult.stdout.trim() || null : null;
  const status = statusResult.code === 0 ? statusResult.stdout : "";
  const changedFiles = status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .sort();
  const fingerprint = createHash("sha256")
    .update(`${head ?? ""}\u0000${status}`, "utf8")
    .digest("hex");
  return { head, fingerprint, changedFiles };
}
