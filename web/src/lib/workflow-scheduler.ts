import { bindSession, getDb, getWorkspace, type WorkflowNodeAttemptRow } from "./db";
import { ocServer } from "./oc-server";
import {
  SESSION_LIST_PATH,
  activeSessionMessagePath,
  activePromptPath,
} from "./opencode-paths";
import { applyWorkflowSessionPermissions } from "./opencode-task-permission";
import { buildWorkflowPrompt } from "./workflow-prompt";
import { parseImplementResult, parseReviewResult } from "./workflow";
import { normalizeOcList } from "./attention";
import type { MessageWithParts } from "./types";
import type { WorkflowNodeConfig, WorkflowNodeKey } from "./workflow-types";
import { readWorkflowWorkspaceSnapshot } from "./workflow-git";
import { isWorkflowModeEnabled } from "./workflow-feature";
import { workflowArtifactsForPrompt } from "./workflow-artifacts";
import { recordReviewGateAttempt } from "./workflow-control";
import {
  collaborationContextFor,
  prependCollaborationContext,
} from "./collaboration-context";
import { evaluateWorkflowGraphRuntime } from "./workflow-graph-runtime";
import { executeReviewGate, parseReviewGateInput } from "./workflow-control-executor";
import {
  resolveLegacyExecutor,
  resolveLegacyControlExecutor,
  resolveSnapshotExecutor,
  WorkflowExecutorResolutionError,
  type WorkflowExecutor,
} from "./workflow-executor-registry";
import type { WorkflowExecutionSnapshot } from "./workflow-graph-types";

const SCHEDULER_INTERVAL_MS = 2_500;
const IMPLEMENT_ATTEMPT_LIMIT = 10;
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

function executorForRun(workflowRunId: string, nodeKey: string): WorkflowExecutor {
  const run = getDb().prepare("SELECT definition_snapshot FROM workflow_runs WHERE id = ?").get(workflowRunId) as { definition_snapshot: string } | undefined;
  if (!run) throw new WorkflowExecutorResolutionError(`Workflow Run ${workflowRunId} is missing`);
  const snapshot = parseJson(run.definition_snapshot, null) as Partial<WorkflowExecutionSnapshot> | null;
  if (snapshot?.schemaVersion === "workflow-execution-v2") {
    return resolveSnapshotExecutor(snapshot as WorkflowExecutionSnapshot, nodeKey);
  }
  if (nodeKey === "implement_ui" || nodeKey === "code_review" || nodeKey === "visual_judge") {
    return resolveLegacyExecutor(nodeKey);
  }
  if (nodeKey === "review_gate") return resolveLegacyControlExecutor();
  throw new WorkflowExecutorResolutionError(`No legacy executor for Node ${nodeKey}`);
}

function graphRuntimeForRun(workflowRunId: string) {
  const run = getDb().prepare("SELECT definition_snapshot FROM workflow_runs WHERE id = ?").get(workflowRunId) as { definition_snapshot: string } | undefined;
  const snapshot = parseJson(run?.definition_snapshot, null) as WorkflowExecutionSnapshot | null;
  if (snapshot?.schemaVersion !== "workflow-execution-v2") return null;
  const rows = getDb()
    .prepare(
      `SELECT n.node_key AS node_id, COALESCE(a.status, 'pending') AS status,
              COALESCE(a.attempt_no, 0) AS attempt_no, a.result
       FROM workflow_node_runs n
       LEFT JOIN workflow_node_attempts a ON a.node_run_id = n.id AND a.attempt_no = n.latest_attempt_no
       WHERE n.workflow_run_id = ?`,
    )
    .all(workflowRunId) as Array<{ node_id: string; status: string; attempt_no: number; result: string | null }>;
  return evaluateWorkflowGraphRuntime(snapshot, rows.map((row) => ({
    nodeId: row.node_id,
    status: row.status,
    attemptNo: row.attempt_no,
    result: parseJson(row.result, null),
  })));
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
       WHERE r.status IN ('running', 'pause_requested') AND a.status = 'running'
       ORDER BY a.rowid ASC`,
    )
    .all() as WorkflowNodeAttemptRow[];
}

/** Spec: pause_requested + all in-flight done → paused (after result save). */
function finalizePauseRequestedIfIdle(workflowRunId: string): void {
  const database = getDb();
  const inFlight = database
    .prepare(
      `SELECT 1 FROM workflow_node_attempts a
       JOIN workflow_node_runs n ON n.id = a.node_run_id
       WHERE n.workflow_run_id = ?
         AND a.status IN ('creating_session', 'dispatching', 'running')
       LIMIT 1`,
    )
    .get(workflowRunId);
  if (inFlight) return;
  database
    .prepare(
      `UPDATE workflow_runs
       SET status = 'paused', revision = revision + 1, updated_at = ?
       WHERE id = ? AND status = 'pause_requested'`,
    )
    .run(new Date().toISOString(), workflowRunId);
}

function finalizeIdlePauseRequestedRuns(): void {
  const runs = getDb()
    .prepare(`SELECT id FROM workflow_runs WHERE status = 'pause_requested'`)
    .all() as Array<{ id: string }>;
  for (const run of runs) finalizePauseRequestedIfIdle(run.id);
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

function messagesAfterBoundary(messages: MessageWithParts[], lastMessageId: string | null): MessageWithParts[] | null {
  if (!lastMessageId) return messages;
  const index = messages.findIndex((message) => message.info.id === lastMessageId);
  return index < 0 ? null : messages.slice(index + 1);
}

function usageSnapshot(messages: MessageWithParts[]): string {
  const assistant = messages.filter((message) => message.info.role === "assistant");
  const tokens = assistant.reduce((sum, message) => sum + (message.info.tokens?.total ?? 0), 0);
  const cost = assistant.reduce((sum, message) => sum + (message.info.cost ?? 0), 0);
  const times = assistant.flatMap((message) => {
    const time = message.info.time;
    return time?.created && time.completed ? [time.created, time.completed] : [];
  });
  return JSON.stringify({
    messageCount: assistant.length,
    tokens,
    cost,
    durationMs: times.length ? Math.max(...times) - Math.min(...times) : 0,
    capturedAt: new Date().toISOString(),
  });
}

async function workspaceMatchesImplementSubject(workspaceId: string, workflowRunId: string): Promise<boolean> {
  const expected = getDb().prepare(
    `SELECT a.dirty_fingerprint FROM workflow_node_attempts a
     JOIN workflow_node_runs n ON n.id = a.node_run_id
     WHERE n.workflow_run_id = ? AND n.node_key = 'implement_ui' AND a.attempt_no = n.latest_attempt_no`,
  ).get(workflowRunId) as { dirty_fingerprint: string | null } | undefined;
  if (!expected?.dirty_fingerprint) return false;
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return false;
  const current = await readWorkflowWorkspaceSnapshot(workspace.absolute_path);
  return current.fingerprint === expected.dirty_fingerprint;
}

function recoverInterruptedAttempts(): void {
  const now = new Date().toISOString();
  getDb().transaction(() => {
    const interrupted = getDb().prepare(
      `SELECT DISTINCT r.id FROM workflow_runs r
       JOIN workflow_node_runs n ON n.workflow_run_id = r.id
       JOIN workflow_node_attempts a ON a.node_run_id = n.id
       WHERE r.status IN ('running', 'pause_requested') AND a.status IN ('creating_session', 'dispatching')`,
    ).all() as Array<{ id: string }>;
    getDb().prepare(
      `UPDATE workflow_node_attempts SET status = 'failed', dispatch_status = 'unknown_delivery', error = 'Scheduler restart requires a manual retry', finished_at = ?, revision = revision + 1
       WHERE status IN ('creating_session', 'dispatching')`,
    ).run(now);
    for (const run of interrupted) {
      getDb().prepare(
        `UPDATE workflow_runs SET status = 'paused', pause_reason = 'scheduler_restart', error = 'An in-flight Attempt was interrupted by scheduler restart', revision = revision + 1, updated_at = ? WHERE id = ? AND status IN ('running', 'pause_requested')`,
      ).run(now, run.id);
    }
  })();
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
      const session = await ocServer<{ id: string }>(workspace.absolute_path, SESSION_LIST_PATH, {
        method: "POST",
        body: { title: `${node.node_key} ${marker}` },
      });
      bindSession(workspaceId, session.id, node.node_key);
      const now = new Date().toISOString();
      const nextAttemptNo = node.latest_attempt_no + 1;
      database
        .prepare(
          `UPDATE workflow_node_runs SET latest_attempt_no = ?, updated_at = ?
           WHERE id = ? AND latest_attempt_no = ?`,
        )
        .run(nextAttemptNo, now, node.id, node.latest_attempt_no);
      database
        .prepare(
          `INSERT INTO workflow_node_attempts
           (id, node_run_id, attempt_no, opencode_session_id, status, config_snapshot, output_mode, dispatch_status)
           VALUES (?, ?, ?, ?, 'ready', ?, 'fenced_json', 'not_sent')`,
        )
        .run(crypto.randomUUID(), node.id, nextAttemptNo, session.id, node.config);
    }),
  );
}

export async function advanceReviewGate(workflowRunId: string): Promise<void> {
  const database = getDb();
  try {
    if (executorForRun(workflowRunId, "review_gate").runtime !== "server_control") return;
  } catch {
    return;
  }
  const rows = database
    .prepare(
      `SELECT a.id AS attempt_id, n.node_key, n.config, a.status, a.result
       FROM workflow_node_runs n JOIN workflow_node_attempts a ON a.node_run_id = n.id AND a.attempt_no = n.latest_attempt_no
       WHERE n.workflow_run_id = ? AND n.node_key IN ('code_review', 'visual_judge')`,
    )
    .all(workflowRunId) as Array<{ attempt_id: string; node_key: "code_review" | "visual_judge"; config: string; status: string; result: string | null }>;
  if (rows.length !== 2 || rows.some((row) => row.status !== "succeeded")) return;
  const gateDecision = executeReviewGate(rows.map((row) => ({
    status: row.status,
    result: parseReviewGateInput(row.result),
    config: JSON.parse(row.config),
  })));
  const findings = gateDecision.decision === "return_to_implement" ? gateDecision.findings : [];
  recordReviewGateAttempt({
    workflowRunId,
    reviewers: rows.map((row) => ({
      attemptId: row.attempt_id,
      nodeKey: row.node_key,
      status: row.status,
      result: row.result ? parseReviewResult(JSON.parse(row.result)) : null,
    })),
    decision: gateDecision,
  });
  const now = new Date().toISOString();
  if (gateDecision.decision === "pause") {
    database
      .prepare("UPDATE workflow_runs SET status = 'paused', pause_reason = 'review_blocked', revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'running'")
      .run(now, workflowRunId);
    return;
  }
  if (!findings.length) {
    database
      .prepare("UPDATE workflow_runs SET status = 'completed', revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'running'")
      .run(now, workflowRunId);
    return;
  }
  const run = database
    .prepare("SELECT workspace_id, cycle_count, max_cycles FROM workflow_runs WHERE id = ?")
    .get(workflowRunId) as { workspace_id: string; cycle_count: number; max_cycles: number } | undefined;
  if (!run) return;
  if (run.cycle_count >= run.max_cycles) {
    database
      .prepare("UPDATE workflow_runs SET status = 'paused', pause_reason = 'max_cycles', revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'running'")
      .run(now, workflowRunId);
    return;
  }
  const implement = database
    .prepare("SELECT id, config, latest_attempt_no FROM workflow_node_runs WHERE workflow_run_id = ? AND node_key = 'implement_ui'")
    .get(workflowRunId) as { id: string; config: string; latest_attempt_no: number } | undefined;
  const workspace = getWorkspace(run.workspace_id);
  if (!implement || !workspace?.primary_session_id) return;
  const nextAttempt = implement.latest_attempt_no + 1;
  const changed = database
    .prepare("UPDATE workflow_node_runs SET latest_attempt_no = ?, updated_at = ? WHERE id = ? AND latest_attempt_no = ?")
    .run(nextAttempt, now, implement.id, implement.latest_attempt_no);
  if (changed.changes !== 1) return;
  database
    .prepare(
      `INSERT INTO workflow_node_attempts
       (id, node_run_id, attempt_no, opencode_session_id, status, config_snapshot, input, output_mode, dispatch_status)
       VALUES (?, ?, ?, ?, 'ready', ?, ?, 'fenced_json', 'not_sent')`,
    )
    .run(crypto.randomUUID(), implement.id, nextAttempt, workspace.primary_session_id, implement.config, JSON.stringify({ findings }));
  database
    .prepare("UPDATE workflow_runs SET cycle_count = cycle_count + 1, revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'running'")
    .run(now, workflowRunId);
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
  let executor: WorkflowExecutor;
  try {
    executor = executorForRun(info.workflow_run_id, info.node_key);
  } catch (error) {
    return pauseWorkflowForAttempt(attempt.id, "unsupported_executor", error instanceof Error ? error.message : String(error));
  }
  if (executor.runtime !== "opencode_session") return;
  const workspace = getWorkspace(info.workspace_id);
  if (!workspace) return;
  let messages: MessageWithParts[];
  try {
    const raw = await ocServer<unknown>(
      workspace.absolute_path,
      activeSessionMessagePath(attempt.opencode_session_id),
      { timeoutMs: 10_000 },
    );
    // v2 message endpoints wrap the list in `{ data: [...] }`.
    messages = normalizeOcList<MessageWithParts>(raw);
  } catch {
    return;
  }
  if (messages.length === 0) return;
  const boundedMessages = messagesAfterBoundary(messages, attempt.last_message_id);
  if (!boundedMessages) return;
  const result = extractWorkflowResult(boundedMessages, attempt.prompt_marker, info.node_key);
  if (!result) return;
  const resultMessage = [...boundedMessages].reverse().find((message) => message.info.role === "assistant" && message.info.id);
  const now = new Date().toISOString();
  if ((info.node_key === "code_review" || info.node_key === "visual_judge") && !(await workspaceMatchesImplementSubject(info.workspace_id, info.workflow_run_id))) {
    return pauseWorkflowForAttempt(attempt.id, "workspace_drift", "Workspace changed since Implement completed.");
  }
  let finishHead: string | null = null;
  let finishFingerprint: string | null = null;
  if (info.node_key === "implement_ui") {
    const snapshot = getWorkspace(info.workspace_id);
    if (snapshot) {
      const current = await readWorkflowWorkspaceSnapshot(snapshot.absolute_path);
      finishHead = current.head;
      finishFingerprint = current.fingerprint;
    }
  }
  const updated = getDb()
    .prepare(
      `UPDATE workflow_node_attempts
       SET status = 'succeeded', outcome = ?, result = ?, last_message_id = ?, usage_snapshot = ?, finish_head = COALESCE(?, finish_head), dirty_fingerprint = COALESCE(?, dirty_fingerprint), dispatch_status = 'result_received',
           finished_at = ?, revision = revision + 1
       WHERE id = ? AND status = 'running'`,
    )
    .run(
      JSON.stringify({ kind: info.node_key === "implement_ui" ? "implement" : "review", value: info.node_key === "implement_ui" ? (result as { status: string }).status : (result as { verdict: string }).verdict }),
      JSON.stringify(result),
      resultMessage?.info.id ?? null,
      usageSnapshot(boundedMessages),
      finishHead,
      finishFingerprint,
      now,
      attempt.id,
    );
  if (updated.changes === 1 && info.node_key === "implement_ui" && (result as { status: string }).status === "completed") {
    await activateReviewers(info.workspace_id, info.workflow_run_id);
  }
  if (updated.changes === 1 && (info.node_key === "code_review" || info.node_key === "visual_judge")) {
    await advanceReviewGate(info.workflow_run_id);
  }
  if (updated.changes === 1) {
    finalizePauseRequestedIfIdle(info.workflow_run_id);
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

function pauseAttemptBestEffort(attemptId: string, error: unknown): void {
  try {
    pauseWorkflowForAttempt(
      attemptId,
      "scheduler_error",
      error instanceof Error ? error.message : String(error),
    );
  } catch {
    /* a failed pause must not abort the tick and starve other runs */
  }
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
  let executor: WorkflowExecutor;
  try {
    executor = executorForRun(node.workflow_run_id, node.node_key);
  } catch (error) {
    return pauseWorkflowForAttempt(attempt.id, "unsupported_executor", error instanceof Error ? error.message : String(error));
  }
  if (executor.runtime !== "opencode_session") {
    return pauseWorkflowForAttempt(attempt.id, "scheduler_error", `Executor ${executor.key} is not an OpenCode Session executor.`);
  }
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
  const visualArtifacts = node.node_key === "visual_judge" ? workflowArtifactsForPrompt(node.workflow_run_id) : [];
  if (node.node_key === "visual_judge" && visualArtifacts.length === 0) {
    return pauseWorkflowForAttempt(attempt.id, "visual_artifact_missing", "Visual Judgeに利用可能なスクリーンショットがありません。明示的なartifact登録またはSkipが必要です。");
  }
  if (node.node_key === "code_review" || node.node_key === "visual_judge") {
    if (!(await workspaceMatchesImplementSubject(workspace.id, node.workflow_run_id))) {
      return pauseWorkflowForAttempt(attempt.id, "workspace_drift", "Workspace changed since Implement completed.");
    }
  }
  try {
    const raw = await ocServer<unknown>(
      workspace.absolute_path,
      activeSessionMessagePath(attempt.opencode_session_id),
      { timeoutMs: 10_000 },
    );
    // v2 message endpoints wrap the list in `{ data: [...] }`.
    const previousMessages = normalizeOcList<MessageWithParts>(raw);
    const lastMessageId = previousMessages.at(-1)?.info.id ?? null;
    getDb()
      .prepare("UPDATE workflow_node_attempts SET last_message_id = ? WHERE id = ? AND status = 'dispatching'")
      .run(lastMessageId, attempt.id);
  } catch (error) {
    return pauseWorkflowForAttempt(attempt.id, "unknown_delivery", error instanceof Error ? error.message : String(error));
  }
  let prompt;
  try {
    const snapshot = await readWorkflowWorkspaceSnapshot(workspace.absolute_path);
    getDb().prepare("UPDATE workflow_node_attempts SET start_head = ?, dirty_fingerprint = ? WHERE id = ? AND status = 'dispatching'").run(snapshot.head, snapshot.fingerprint, attempt.id);
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
      artifacts: visualArtifacts,
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
    const sendBody = prependCollaborationContext(
      {
        parts: [{ type: "text", text: prompt.promptText }],
        ...modelBody(config),
      },
      await collaborationContextFor({
        workspaceId: workspace.id,
        sessionId: attempt.opencode_session_id,
        directory: workspace.absolute_path,
      }),
    );
    await ocServer(
      workspace.absolute_path,
      activePromptPath(attempt.opencode_session_id),
      {
        method: "POST",
        body: sendBody,
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
    if (!isWorkflowModeEnabled()) {
      const now = new Date().toISOString();
      getDb()
        .prepare(
          `UPDATE workflow_runs
           SET status = 'paused', pause_reason = 'feature_disabled', revision = revision + 1, updated_at = ?
           WHERE status NOT IN ('completed', 'failed', 'stopped', 'detached', 'paused')`,
        )
        .run(now);
      return;
    }
    // Snapshot ready work before result processing. Reviewer Attempts created
    // by a completed Implement must wait for the next tick so Visual Judge
    // artifacts can be registered before dispatch.
    const ready = readyAttempts();
    for (const attempt of runningAttempts()) {
      try {
        await processRunningAttempt(attempt);
      } catch (error) {
        pauseAttemptBestEffort(attempt.id, error);
      }
    }
    finalizeIdlePauseRequestedRuns();
    for (const attempt of ready) {
      const node = getDb().prepare("SELECT n.node_key, n.workflow_run_id FROM workflow_node_runs n WHERE n.id = ?").get(attempt.node_run_id) as { node_key: string; workflow_run_id: string } | undefined;
      if (!node) continue;
      let executor: WorkflowExecutor;
      try {
        executor = executorForRun(node.workflow_run_id, node.node_key);
      } catch (error) {
        if (claimAttempt(attempt)) pauseWorkflowForAttempt(attempt.id, "unsupported_executor", error instanceof Error ? error.message : String(error));
        continue;
      }
      if (executor.runtime !== "opencode_session") {
        if (claimAttempt(attempt)) pauseWorkflowForAttempt(attempt.id, "scheduler_error", `Executor ${executor.key} cannot dispatch a Session.`);
        continue;
      }
      const graphRuntime = graphRuntimeForRun(node.workflow_run_id);
      if (graphRuntime && !graphRuntime.readyNodeIds.includes(node.node_key)) {
        if (graphRuntime.blockedNodeIds.includes(node.node_key) && graphRuntime.pauseReason) {
          if (claimAttempt(attempt)) pauseWorkflowForAttempt(attempt.id, graphRuntime.pauseReason, `Graph dependency blocked Node ${node.node_key}.`);
        }
        continue;
      }
      if (node?.node_key === "implement_ui" && attempt.attempt_no > IMPLEMENT_ATTEMPT_LIMIT) {
        if (claimAttempt(attempt)) pauseWorkflowForAttempt(attempt.id, "max_attempts", `Implement Attempt limit (${IMPLEMENT_ATTEMPT_LIMIT}) exceeded.`);
        continue;
      }
      if (claimAttempt(attempt)) {
        try {
          await dispatchAttempt({ ...attempt, status: "dispatching" });
        } catch (error) {
          pauseAttemptBestEffort(attempt.id, error);
        }
      }
    }
  } finally {
    schedulerTicking = false;
  }
}

export function startWorkflowScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  recoverInterruptedAttempts();
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
