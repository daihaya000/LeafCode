import { createHash } from "node:crypto";
import { getDb } from "./db";

export type WorkflowControlReviewerAudit = {
  attemptId: string;
  nodeKey: "code_review" | "visual_judge";
  status: string;
  result: unknown;
};

export type WorkflowControlDecision =
  | { decision: "pass" | "skip" }
  | { decision: "return_to_implement"; findings: unknown[] }
  | { decision: "pause"; reason: "blocked" | "failed" | "unknown_result" };

export function recordReviewGateAttempt(input: {
  workflowRunId: string;
  reviewers: WorkflowControlReviewerAudit[];
  decision: WorkflowControlDecision;
  now?: string;
}): string | null {
  const database = getDb();
  const now = input.now ?? new Date().toISOString();
  const controlNode = database
    .prepare(
      `SELECT id, latest_attempt_no FROM workflow_node_runs
       WHERE workflow_run_id = ? AND node_key = 'review_gate' AND kind = 'control'`,
    )
    .get(input.workflowRunId) as { id: string; latest_attempt_no: number } | undefined;
  if (!controlNode) return null;

  const auditInput = {
    reviewers: input.reviewers.map((reviewer) => ({
      attemptId: reviewer.attemptId,
      nodeKey: reviewer.nodeKey,
      status: reviewer.status,
      result: reviewer.result,
    })),
  };
  const inputJson = JSON.stringify(auditInput);
  const resultJson = JSON.stringify(input.decision);
  const inputHash = `sha256:${createHash("sha256").update(inputJson, "utf8").digest("hex")}`;
  const attemptId = crypto.randomUUID();
  const attemptNo = controlNode.latest_attempt_no + 1;

  database.transaction(() => {
    const updated = database
      .prepare(
        `UPDATE workflow_node_runs
         SET latest_attempt_no = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND latest_attempt_no = ?`,
      )
      .run(attemptNo, now, controlNode.id, controlNode.latest_attempt_no);
    if (updated.changes !== 1) throw new Error("Control Node revision conflict");
    database
      .prepare(
        `INSERT INTO workflow_node_attempts
         (id, node_run_id, attempt_no, opencode_session_id, status, outcome,
          config_snapshot, input, result, input_hash, output_mode, dispatch_status,
          started_at, finished_at)
         VALUES (?, ?, ?, NULL, 'succeeded', ?, '{}', ?, ?, ?, 'fenced_json', 'control_evaluated', ?, ?)`,
      )
      .run(
        attemptId,
        controlNode.id,
        attemptNo,
        JSON.stringify({ kind: "control", value: input.decision.decision }),
        inputJson,
        resultJson,
        inputHash,
        now,
        now,
      );
  })();
  return attemptId;
}
