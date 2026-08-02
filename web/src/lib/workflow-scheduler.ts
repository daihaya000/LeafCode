import { bindSession, getDb, getWorkspace, type WorkflowNodeAttemptRow } from "./db";
import { ocServer } from "./oc-server";
import { applyWorkflowSessionPermissions } from "./opencode-task-permission";
import { buildWorkflowPrompt } from "./workflow-prompt";
import { parseImplementResult, parseReviewResult } from "./workflow";
import type { MessageWithParts } from "./types";
import type { WorkflowNodeConfig, WorkflowNodeKey } from "./workflow-types";
import { readWorkflowWorkspaceSnapshot } from "./workflow-git";

const SCHEDULER_INTERVAL_MS = 2_500;
let schedulerStarted = false;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerTicking = false;

function parseJson(value: string | null | undefined, fallback: unknown): unknown {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function readyAttempts(): WorkflowNodeAttemptRow[] {
  return getDb()
    .prepare(
      `SELECT a.* FROM workflow_node_attempts a
       JOIN workflow_node_runs n ON n.id = a.node_run_id
       JOIN workflow_runs r ON r.id = n.workflow_run_id
       WHERE r.status = 'running' AND a.status = 'ready'
       ORDER BY a.rowid ASC`,
    )
    .all() as WorkflowNodeAttemptRow[];
}

function runningAttempts(): WorkflowNodeAttemptRow[] {
  return getDb()
    .prepare(
      `SELECT a.* FROM workflow_node_attempts a
       JOIN workflow_node_runs n ON n.id = a.node_run_id
       JOIN workflow_runs r ON r.id = n.workflow_run_id
       WHERE r.status = 'running' AND a.status = 'running'
       ORDER BY a.rowid ASC`,
    )
    .all() as WorkflowNodeAttemptRow[];
}

function messageText(message: MessageWithParts): string {
  return message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

function extractWorkflowResult(
  messages: MessageWithParts[],
  marker: string | null,
  nodeKey: WorkflowNodeKey,
): unknown | null {
  if (!marker) return null;
  const expected = `<!-- webui-workflow-result:${marker} -->`;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.info.role !== "assistant" || !message.info.time?.completed) continue;
    const text = messageText(message);
    const start = text.indexOf(expected);
    if (start < 0) continue;
    const fence = text.slice(start + expected.length).match(/```json\s*([\s\S]*?)```/i);
    if (!fence?.[1]) return null;
    try {
      const parsed: unknown = JSON.parse(fence[1]);
      return nodeKey === "implement_ui"
        ? parseImplementResult(parsed)
        : parseReviewResult(parsed);
    } catch {
      return null;
    }
  }
  return null;
}

async function activateReviewers(
  workspaceId: string,
  workflowRunId: string,
): Promise<void> {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error("workspace not found");
  const database = getDb();
  const reviewerNodes = database
    .prepare(
      `SELECT * FROM workflow_node_runs
       WHERE workflow_run_id = ? AND node_key IN ('code_review', 'visual_judge')
       ORDER BY node_key ASC`,
    )
    .all(workflowRunId) as Array<{ id: string; node_key: WorkflowNodeKey; config: string; latest_attempt_no: number }>;
  await Promise.all(
    reviewerNodes.map(async (node) => {
      const marker = `workflow-session-${crypto.randomUUID()}`;
      const session = await ocServer<{ id: string }>(workspace.absolute_path, "/session", {
        method: "POST",
        body: { title: `${node.node_key} ${marker}` },
      });
      bindSession(workspaceId, session.id, node.node_key);
      const now = new Date().toISOString();
      database
        .prepare(
          `UPDATE workflow_node_runs SET latest_attempt_no = 1, updated_at = ?
           WHERE id = ? AND latest_attempt_no = 0`,
        )
        .run(now, node.id);
      database
        .prepare(
          `INSERT INTO workflow_node_attempts
           (id, node_run_id, attempt_no, opencode_session_id, status, config_snapshot, output_mode, dispatch_status)
           VALUES (?, ?, 1, ?, 'ready', ?, 'fenced_json', 'not_sent')`,
        )
        .run(crypto.randomUUID(), node.id, session.id, node.config);
    }),
  );
}

async function processRunningAttempt(attempt: WorkflowNodeAttemptRow): Promise<void> {
  if (!attempt.opencode_session_id) return;
  const info = getDb()
    .prepare(
      `SELECT n.node_key, r.workspace_id, r.id AS workflow_run_id
       FROM workflow_node_runs n JOIN workflow_runs r ON r.id = n.workflow_run_id
       WHERE n.id = ?`,
    )
    .get(attempt.node_run_id) as { node_key: WorkflowNodeKey; workspace_id: string; workflow_run_id: string } | undefined;
  if (!info) return;
  const workspace = getWorkspace(info.workspace_id);
  if (!workspace) return;
  let messages: MessageWithParts[];
  try {
    messages = await ocServer<MessageWithParts[]>(
      workspace.absolute_path,
      `/session/${encodeURIComponent(attempt.opencode_session_id)}/message`,
      { timeoutMs: 10_000 },
    );
  } catch {
    return;
  }
  const result = extractWorkflowResult(messages, attempt.prompt_marker, info.node_key);
  if (!result) return;
  const now = new Date().toISOString();
  const updated = getDb()
    .prepare(
      `UPDATE workflow_node_attempts
       SET status = 'succeeded', outcome = ?, result = ?, dispatch_status = 'result_received',
           finished_at = ?, revision = revision + 1
       WHERE id = ? AND status = 'running'`,
    )
    .run(
      JSON.stringify({ kind: info.node_key === "implement_ui" ? "implement" : "review", value: info.node_key === "implement_ui" ? (result as { status: string }).status : (result as { verdict: string }).verdict }),
      JSON.stringify(result),
      now,
      attempt.id,
    );
  if (updated.changes === 1 && info.node_key === "implement_ui" && (result as { status: string }).status === "completed") {
    await activateReviewers(info.workspace_id, info.workflow_run_id);
  }
}

function claimAttempt(attempt: WorkflowNodeAttemptRow): boolean {
  const result = getDb()
    .prepare(
      `UPDATE workflow_node_attempts
       SET status = 'dispatching', dispatch_status = 'sending', revision = revision + 1
       WHERE id = ? AND status = 'ready' AND revision = ?`,
    )
    .run(attempt.id, attempt.revision);
  return result.changes === 1;
}

function pauseWorkflowForAttempt(
  attemptId: string,
  reason: string,
  error: string,
): void {
  const now = new Date().toISOString();
  const database = getDb();
  database.transaction(() => {
    database
      .prepare(
        `UPDATE workflow_node_attempts
         SET status = 'failed', dispatch_status = 'parse_failed', error = ?,
             revision = revision + 1, finished_at = ?
         WHERE id = ? AND status = 'dispatching'`,
      )
      .run(error.slice(0, 4000), now, attemptId);
    database
      .prepare(
        `UPDATE workflow_runs
         SET status = 'paused', pause_reason = ?, error = ?, revision = revision + 1, updated_at = ?
         WHERE id = (SELECT n.workflow_run_id FROM workflow_node_attempts a JOIN workflow_node_runs n ON n.id = a.node_run_id WHERE a.id = ?)
           AND status IN ('running', 'pause_requested')`,
      )
      .run(reason, error.slice(0, 4000), now, attemptId);
  })();
}

function modelBody(config: WorkflowNodeConfig): Record<string, unknown> {
  const body: Record<string, unknown> = {
    agent: config.agentName,
  };
  if (config.model.mode === "explicit") {
    body.model = {
      providerID: config.model.providerID,
      modelID: config.model.modelID,
    };
    if (config.model.variant) body.variant = config.model.variant;
  }
  return body;
}

async function dispatchAttempt(attempt: WorkflowNodeAttemptRow): Promise<void> {
  const node = getDb()
    .prepare("SELECT * FROM workflow_node_runs WHERE id = ?")
    .get(attempt.node_run_id) as { workflow_run_id: string; node_key: WorkflowNodeKey; kind: string; config: string } | undefined;
  if (!node) return pauseWorkflowForAttempt(attempt.id, "scheduler_error", "Workflow Nodeが見つかりません。");
  const run = getDb().prepare("SELECT * FROM workflow_runs WHERE id = ?").get(node.workflow_run_id) as {
    task_context_snapshot: string;
    cycle_count: number;
    status: string;
  } | undefined;
  const runWorkspace = getDb()
    .prepare("SELECT workspace_id FROM workflow_runs WHERE id = ?")
    .get(node.workflow_run_id) as { workspace_id: string } | undefined;
  const workspace = runWorkspace ? getWorkspace(runWorkspace.workspace_id) : undefined;
  if (!run || !workspace || run.status !== "running" || !attempt.opencode_session_id) {
    return pauseWorkflowForAttempt(attempt.id, "engine_unavailable", "Workflow Attemptの実行条件が満たされません。");
  }
  const config = parseJson(node.config, null) as WorkflowNodeConfig | null;
  if (!config) return pauseWorkflowForAttempt(attempt.id, "scheduler_error", "Node設定を読めません。");
  let prompt;
  try {
    const snapshot = await readWorkflowWorkspaceSnapshot(workspace.absolute_path);
    prompt = buildWorkflowPrompt({
      runId: node.workflow_run_id,
      nodeKey: node.node_key,
      attemptId: attempt.id,
      cycle: run.cycle_count,
      promptMarker: `workflow-${attempt.id}`,
      task: parseJson(run.task_context_snapshot, { goal: "", acceptance: [], constraints: [] }) as {
        goal: string;
        acceptance: string[];
        constraints: string[];
      },
      nodeInstructions: config.instructions,
      workspace: snapshot,
    });
  } catch (error) {
    const candidate =
      error instanceof Error && "reason" in error
        ? String((error as { reason?: unknown }).reason)
        : "scheduler_error";
    const reason = candidate === "input_too_large" ? candidate : "scheduler_error";
    return pauseWorkflowForAttempt(attempt.id, reason, error instanceof Error ? error.message : String(error));
  }
  const now = new Date().toISOString();
  const saved = getDb()
    .prepare(
      `UPDATE workflow_node_attempts
       SET prompt_marker = ?, prompt_template_version = ?, output_schema_version = ?,
           input_hash = ?, input_truncated = ?, input = ?, prompt_generated_at = ?,
           dispatch_status = 'sending', revision = revision + 1
       WHERE id = ? AND status = 'dispatching'`,
    )
    .run(
      prompt.envelope.promptMarker,
      prompt.envelope.templateVersion,
      prompt.envelope.outputSchemaVersion,
      prompt.inputHash,
      JSON.stringify(prompt.inputTruncated),
      JSON.stringify(prompt.envelope),
      now,
      attempt.id,
    );
  if (saved.changes !== 1) return;
  try {
    await applyWorkflowSessionPermissions(workspace.absolute_path, attempt.opencode_session_id, config.permissions);
    await ocServer(
      workspace.absolute_path,
      `/session/${encodeURIComponent(attempt.opencode_session_id)}/prompt_async`,
      {
        method: "POST",
        body: {
          parts: [{ type: "text", text: prompt.promptText }],
          ...modelBody(config),
        },
        timeoutMs: 120_000,
      },
    );
    getDb()
      .prepare(
        `UPDATE workflow_node_attempts
         SET status = 'running', dispatch_status = 'awaiting_result', started_at = ?, revision = revision + 1
         WHERE id = ? AND status = 'dispatching'`,
      )
      .run(now, attempt.id);
  } catch (error) {
    pauseWorkflowForAttempt(
      attempt.id,
      "unknown_delivery",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function runWorkflowSchedulerTick(): Promise<void> {
  if (schedulerTicking) return;
  schedulerTicking = true;
  try {
    for (const attempt of runningAttempts()) await processRunningAttempt(attempt);
    for (const attempt of readyAttempts()) {
      if (claimAttempt(attempt)) await dispatchAttempt({ ...attempt, status: "dispatching" });
    }
  } finally {
    schedulerTicking = false;
  }
}

export function startWorkflowScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  schedulerTimer = setInterval(() => {
    void runWorkflowSchedulerTick();
  }, SCHEDULER_INTERVAL_MS);
  void runWorkflowSchedulerTick();
}

export function stopWorkflowSchedulerForTests(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  schedulerStarted = false;
  schedulerTicking = false;
}
