import {
  getDb,
  getWorkspace,
  type WorkflowNodeAttemptRow,
  type WorkflowNodeRunRow,
  type WorkflowRunRow,
} from "./db";
import { readWorkflowGraphByWorkspace } from "./workflow-graph-repository";
import {
  createWorkflowExecutionSnapshot,
  WorkflowExecutionSnapshotError,
} from "./workflow-execution-snapshot";
import {
  assertValidWorkflowNodeConfig,
  validateWorkflowNodeKind,
} from "./workflow";
import {
  createWorkflowDefinitionSnapshot,
  type ReviewResult,
  type WorkflowDefinitionSnapshot,
  type WorkflowNodeConfig,
  type WorkflowNodeKey,
  type WorkflowTaskContext,
} from "./workflow-types";
import type { WorkflowExecutionSnapshot } from "./workflow-graph-types";

const TERMINAL_RUN_STATUSES = ["completed", "failed", "stopped", "detached"] as const;
const IN_FLIGHT_ATTEMPT_STATUSES = ["creating_session", "dispatching", "running"] as const;

export class WorkflowServiceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 500 = 400,
  ) {
    super(message);
    this.name = "WorkflowServiceError";
  }
}

export type WorkflowRunView = {
  id: string;
  workspaceId: string;
  templateKey: string;
  definitionSnapshot: WorkflowDefinitionSnapshot | WorkflowExecutionSnapshot;
  taskContextSnapshot: WorkflowTaskContext;
  status: string;
  cycleCount: number;
  maxCycles: number;
  primaryNodeKey: string;
  revision: number;
  pauseReason: string;
  error: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowAttemptView = {
  id: string;
  nodeRunId: string;
  attemptNo: number;
  opencodeSessionId: string | null;
  status: string;
  outcome: unknown;
  configSnapshot: unknown;
  input: unknown;
  result: unknown;
  error: string;
  promptMarker: string | null;
  lastMessageId: string | null;
  promptTemplateVersion: string | null;
  outputSchemaVersion: string | null;
  inputHash: string | null;
  inputTruncated: unknown;
  usageSnapshot: unknown;
  outputMode: string;
  dispatchStatus: string;
  revision: number;
  startedAt: string | null;
  finishedAt: string | null;
};

export type WorkflowNodeView = {
  id: string;
  workflowRunId: string;
  nodeKey: string;
  kind: string;
  config: unknown;
  latestAttemptNo: number;
  revision: number;
  attempts: WorkflowAttemptView[];
  createdAt: string;
  updatedAt: string;
};

export type WorkflowView = {
  workspaceId: string;
  executionMode: string;
  workspaceRevision: number;
  primarySessionId: string | null;
  run: WorkflowRunView | null;
  nodes: WorkflowNodeView[];
};

function parseJson(value: string | null | undefined, fallback: unknown): unknown {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toRunView(row: WorkflowRunRow): WorkflowRunView {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    templateKey: row.template_key,
    definitionSnapshot: parseJson(row.definition_snapshot, {}) as WorkflowDefinitionSnapshot | WorkflowExecutionSnapshot,
    taskContextSnapshot: parseJson(row.task_context_snapshot, {
      goal: "",
      acceptance: [],
      constraints: [],
    }) as WorkflowTaskContext,
    status: row.status,
    cycleCount: row.cycle_count,
    maxCycles: row.max_cycles,
    primaryNodeKey: row.primary_node_key,
    revision: row.revision,
    pauseReason: row.pause_reason,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAttemptView(row: WorkflowNodeAttemptRow): WorkflowAttemptView {
  return {
    id: row.id,
    nodeRunId: row.node_run_id,
    attemptNo: row.attempt_no,
    opencodeSessionId: row.opencode_session_id,
    status: row.status,
    outcome: parseJson(row.outcome, null),
    configSnapshot: parseJson(row.config_snapshot, {}),
    input: parseJson(row.input, null),
    result: parseJson(row.result, null),
    error: row.error,
    promptMarker: row.prompt_marker,
    lastMessageId: row.last_message_id,
    promptTemplateVersion: row.prompt_template_version,
    outputSchemaVersion: row.output_schema_version,
    inputHash: row.input_hash,
    inputTruncated: parseJson(row.input_truncated, { omittedCount: 0 }),
    usageSnapshot: parseJson(row.usage_snapshot, {}),
    outputMode: row.output_mode,
    dispatchStatus: row.dispatch_status,
    revision: row.revision,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toNodeView(row: WorkflowNodeRunRow, attempts: WorkflowNodeAttemptRow[]): WorkflowNodeView {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    nodeKey: row.node_key,
    kind: row.kind,
    config: parseJson(row.config, {}),
    latestAttemptNo: row.latest_attempt_no,
    revision: row.revision,
    attempts: attempts.map(toAttemptView),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function activeRunRow(workspaceId: string): WorkflowRunRow | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM workflow_runs
       WHERE workspace_id = ?
         AND status NOT IN ('completed', 'failed', 'stopped', 'detached')
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(workspaceId) as WorkflowRunRow | undefined;
}

function latestRunRow(workspaceId: string): WorkflowRunRow | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM workflow_runs
       WHERE workspace_id = ?
       ORDER BY CASE WHEN status IN ('completed', 'failed', 'stopped', 'detached') THEN 1 ELSE 0 END,
                 updated_at DESC
       LIMIT 1`,
    )
    .get(workspaceId) as WorkflowRunRow | undefined;
}

export function getWorkflow(workspaceId: string): WorkflowView | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const run = latestRunRow(workspaceId);
  if (!run) {
    return {
      workspaceId,
      executionMode: workspace.execution_mode,
      workspaceRevision: workspace.revision,
      primarySessionId: workspace.primary_session_id,
      run: null,
      nodes: [],
    };
  }
  const nodeRows = getDb()
    .prepare(
      "SELECT * FROM workflow_node_runs WHERE workflow_run_id = ? ORDER BY rowid ASC",
    )
    .all(run.id) as WorkflowNodeRunRow[];
  const attemptRows = getDb()
    .prepare(
      `SELECT a.* FROM workflow_node_attempts a
       JOIN workflow_node_runs n ON n.id = a.node_run_id
       WHERE n.workflow_run_id = ?
       ORDER BY a.node_run_id ASC, a.attempt_no ASC`,
    )
    .all(run.id) as WorkflowNodeAttemptRow[];
  const attemptsByNode = new Map<string, WorkflowNodeAttemptRow[]>();
  for (const attempt of attemptRows) {
    const entries = attemptsByNode.get(attempt.node_run_id) ?? [];
    entries.push(attempt);
    attemptsByNode.set(attempt.node_run_id, entries);
  }
  return {
    workspaceId,
    executionMode: workspace.execution_mode,
    workspaceRevision: workspace.revision,
    primarySessionId: workspace.primary_session_id,
    run: toRunView(run),
    nodes: nodeRows.map((node) => toNodeView(node, attemptsByNode.get(node.id) ?? [])),
  };
}

export function getActiveWorkflow(workspaceId: string): WorkflowRunRow | undefined {
  return activeRunRow(workspaceId);
}

export function assertNoActiveWorkflow(workspaceId: string): void {
  if (activeRunRow(workspaceId)) {
    throw new WorkflowServiceError("Workflow is active for this task", 409);
  }
}

export function assertNoActiveWorkflowForDirectory(directory: string): void {
  const rows = getDb()
    .prepare(
      `SELECT id FROM workspaces
       WHERE absolute_path = ? AND status <> 'archived'`,
    )
    .all(directory) as { id: string }[];
  for (const row of rows) assertNoActiveWorkflow(row.id);
}

export function workspaceHasActiveWorkflow(workspaceId: string): boolean {
  return Boolean(activeRunRow(workspaceId));
}

export function workspaceHasActiveGoalLoop(workspaceId: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM goal_loops
       WHERE workspace_id = ?
         AND status IN ('queued', 'running', 'verifying_completed')
       LIMIT 1`,
    )
    .get(workspaceId);
  return Boolean(row);
}

function normalizeTaskContext(value: unknown): WorkflowTaskContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowServiceError("task context is required", 400);
  }
  const raw = value as Record<string, unknown>;
  const goal = typeof raw.goal === "string" ? raw.goal.trim() : "";
  const acceptance = raw.acceptance;
  const constraints = raw.constraints;
  if (!goal) throw new WorkflowServiceError("goal is required", 400);
  if (goal.length > 12_000) throw new WorkflowServiceError("goal is too long", 400);
  if (
    !Array.isArray(acceptance) ||
    acceptance.some((item) => typeof item !== "string") ||
    acceptance.length > 50
  ) {
    throw new WorkflowServiceError("acceptance must be a string array", 400);
  }
  if (
    !Array.isArray(constraints) ||
    constraints.some((item) => typeof item !== "string") ||
    constraints.length > 50
  ) {
    throw new WorkflowServiceError("constraints must be a string array", 400);
  }
  return {
    goal,
    acceptance: acceptance.map((item) => item.trim()),
    constraints: constraints.map((item) => item.trim()),
  };
}

function requireExpectedRevision(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new WorkflowServiceError(`${name} is required`, 400);
  }
  return value;
}

export function createWorkflow(input: {
  workspaceId: string;
  workspaceRevision: unknown;
  taskContext: unknown;
}): WorkflowView {
  const expectedWorkspaceRevision = requireExpectedRevision(
    input.workspaceRevision,
    "workspaceRevision",
  );
  const taskContext = normalizeTaskContext(input.taskContext);
  const definition = createWorkflowDefinitionSnapshot();
  const database = getDb();
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  database.transaction(() => {
    const workspace = getWorkspace(input.workspaceId);
    if (!workspace) throw new WorkflowServiceError("task not found", 404);
    if (workspace.execution_mode !== "standard") {
      throw new WorkflowServiceError("task is already in Workflow mode", 409);
    }
    if (workspace.status !== "active") {
      throw new WorkflowServiceError("task is not active", 409);
    }
    if (!workspace.primary_session_id) {
      throw new WorkflowServiceError("primary session is required", 409);
    }
    if (workspace.revision !== expectedWorkspaceRevision) {
      throw new WorkflowServiceError("workspace revision conflict", 409);
    }
    if (workspaceHasActiveGoalLoop(input.workspaceId)) {
      throw new WorkflowServiceError("Goal Loop is active for this task", 409);
    }
    const bound = database
      .prepare(
        `SELECT 1 FROM session_bindings
         WHERE workspace_id = ? AND opencode_session_id = ?`,
      )
      .get(input.workspaceId, workspace.primary_session_id);
    if (!bound) throw new WorkflowServiceError("primary session binding is missing", 409);
    const workspaceUpdate = database
      .prepare(
        `UPDATE workspaces
         SET execution_mode = 'workflow', revision = revision + 1
         WHERE id = ? AND execution_mode = 'standard' AND revision = ?`,
      )
      .run(input.workspaceId, expectedWorkspaceRevision);
    if (workspaceUpdate.changes !== 1) {
      throw new WorkflowServiceError("workspace revision conflict", 409);
    }
    database
      .prepare(
        `INSERT INTO workflow_runs
         (id, workspace_id, template_key, definition_snapshot, task_context_snapshot,
          status, primary_node_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'ready', 'implement_ui', ?, ?)`,
      )
      .run(
        runId,
        input.workspaceId,
        definition.templateKey,
        JSON.stringify(definition),
        JSON.stringify(taskContext),
        now,
        now,
      );
    for (const node of definition.nodes) {
      const nodeRunId = crypto.randomUUID();
      const isImplement = node.key === "implement_ui";
      database
        .prepare(
          `INSERT INTO workflow_node_runs
           (id, workflow_run_id, node_key, kind, config, latest_attempt_no, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          nodeRunId,
          runId,
          node.key,
          node.kind,
          JSON.stringify(node.config),
          isImplement ? 1 : 0,
          now,
          now,
        );
      if (isImplement) {
        database
          .prepare(
            `INSERT INTO workflow_node_attempts
             (id, node_run_id, attempt_no, opencode_session_id, status, config_snapshot,
              output_mode, dispatch_status)
             VALUES (?, ?, 1, ?, 'ready', ?, ?, 'not_sent')`,
          )
          .run(
            crypto.randomUUID(),
            nodeRunId,
            workspace.primary_session_id,
            JSON.stringify(node.config),
            definition.outputMode,
          );
      }
    }
    const controlNodeId = crypto.randomUUID();
    database
      .prepare(
        `INSERT INTO workflow_node_runs
         (id, workflow_run_id, node_key, kind, config, latest_attempt_no, created_at, updated_at)
         VALUES (?, ?, 'review_gate', 'control', '{}', 0, ?, ?)`,
      )
      .run(controlNodeId, runId, now, now);
  })();
  return getWorkflow(input.workspaceId)!;
}

function requireActiveRun(workspaceId: string): WorkflowRunRow {
  const run = activeRunRow(workspaceId);
  if (!run) throw new WorkflowServiceError("active Workflow not found", 404);
  return run;
}

function requireWorkflowRevision(run: WorkflowRunRow, value: unknown): number {
  const revision = requireExpectedRevision(value, "workflowRevision");
  if (revision !== run.revision) throw new WorkflowServiceError("workflow revision conflict", 409);
  return revision;
}

export type WorkflowAction = "start" | "pause" | "resume" | "stop" | "detach";

export function updateWorkflow(input: {
  workspaceId: string;
  action: WorkflowAction;
  workflowRevision: unknown;
  workspaceRevision?: unknown;
  primarySessionId?: unknown;
}): WorkflowView {
  const database = getDb();
  database.transaction(() => {
    const run = requireActiveRun(input.workspaceId);
    requireWorkflowRevision(run, input.workflowRevision);
    const workspace = getWorkspace(input.workspaceId);
    if (!workspace) throw new WorkflowServiceError("task not found", 404);
    if (input.action === "detach") {
      if (workspace.execution_mode !== "workflow") {
        throw new WorkflowServiceError("task is not in Workflow mode", 409);
      }
      if (input.workspaceRevision === undefined || workspace.revision !== input.workspaceRevision) {
        throw new WorkflowServiceError("workspace revision conflict", 409);
      }
      const inFlight = database
        .prepare(
          `SELECT 1 FROM workflow_node_attempts a
           JOIN workflow_node_runs n ON n.id = a.node_run_id
           WHERE n.workflow_run_id = ? AND a.status IN ('creating_session', 'dispatching', 'running')
           LIMIT 1`,
        )
        .get(run.id);
      if (inFlight) throw new WorkflowServiceError("Workflow has an in-flight Attempt", 409);
      if (run.status !== "paused" && !TERMINAL_RUN_STATUSES.includes(run.status as (typeof TERMINAL_RUN_STATUSES)[number])) {
        throw new WorkflowServiceError("Workflow must be paused or terminal before detach", 409);
      }
      const primarySessionId =
        typeof input.primarySessionId === "string" && input.primarySessionId.trim()
          ? input.primarySessionId.trim()
          : workspace.primary_session_id;
      if (!primarySessionId) throw new WorkflowServiceError("primary session is required", 409);
      const bound = database
        .prepare(
          `SELECT 1 FROM session_bindings WHERE workspace_id = ? AND opencode_session_id = ?`,
        )
        .get(input.workspaceId, primarySessionId);
      if (!bound) throw new WorkflowServiceError("primary session binding is missing", 409);
      const workspaceUpdate = database
        .prepare(
          `UPDATE workspaces SET execution_mode = 'standard', primary_session_id = ?, revision = revision + 1
           WHERE id = ? AND execution_mode = 'workflow' AND revision = ?`,
        )
        .run(primarySessionId, input.workspaceId, input.workspaceRevision);
      if (workspaceUpdate.changes !== 1) throw new WorkflowServiceError("workspace revision conflict", 409);
      const runUpdate = database
        .prepare(
          `UPDATE workflow_runs SET status = 'detached', revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(new Date().toISOString(), run.id, input.workflowRevision);
      if (runUpdate.changes !== 1) throw new WorkflowServiceError("workflow revision conflict", 409);
      return;
    }
    if (input.action === "start") {
      if (run.status !== "ready") throw new WorkflowServiceError("Workflow is not ready", 409);
      const draft = readWorkflowGraphByWorkspace(input.workspaceId);
      let publishedSnapshot: string | undefined;
      if (draft) {
        const workspaceRevision = requireExpectedRevision(input.workspaceRevision, "workspaceRevision");
        if (workspace.revision !== workspaceRevision) {
          throw new WorkflowServiceError("workspace revision conflict", 409);
        }
        try {
          publishedSnapshot = JSON.stringify(createWorkflowExecutionSnapshot(draft));
        } catch (error) {
          if (error instanceof WorkflowExecutionSnapshotError) {
            throw new WorkflowServiceError(error.message, 409);
          }
          throw error;
        }
      }
      const updated = database
        .prepare(
          `UPDATE workflow_runs SET status = 'running',
             definition_snapshot = COALESCE(?, definition_snapshot),
             revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'ready' AND revision = ?`,
        )
        .run(publishedSnapshot ?? null, new Date().toISOString(), run.id, input.workflowRevision);
      if (updated.changes !== 1) throw new WorkflowServiceError("workflow revision conflict", 409);
      return;
    }
    if (input.action === "resume") {
      if (run.status !== "paused") throw new WorkflowServiceError("Workflow is not paused", 409);
      const updated = database
        .prepare(
          `UPDATE workflow_runs SET status = 'running', pause_reason = '', revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'paused' AND revision = ?`,
        )
        .run(new Date().toISOString(), run.id, input.workflowRevision);
      if (updated.changes !== 1) throw new WorkflowServiceError("workflow revision conflict", 409);
      return;
    }
    if (input.action === "pause") {
      if (run.status !== "running" && run.status !== "ready") {
        throw new WorkflowServiceError("Workflow cannot be paused", 409);
      }
      const inFlight = database
        .prepare(
          `SELECT 1 FROM workflow_node_attempts a
           JOIN workflow_node_runs n ON n.id = a.node_run_id
           WHERE n.workflow_run_id = ? AND a.status IN ('creating_session', 'dispatching', 'running')
           LIMIT 1`,
        )
        .get(run.id);
      const nextStatus = inFlight ? "pause_requested" : "paused";
      const updated = database
        .prepare(
          `UPDATE workflow_runs SET status = ?, pause_reason = 'user', revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(nextStatus, new Date().toISOString(), run.id, input.workflowRevision);
      if (updated.changes !== 1) throw new WorkflowServiceError("workflow revision conflict", 409);
      return;
    }
    if (input.action === "stop") {
      const updated = database
        .prepare(
          `UPDATE workflow_runs SET status = 'stopped', revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND status NOT IN ('completed', 'failed', 'stopped', 'detached')`,
        )
        .run(new Date().toISOString(), run.id, input.workflowRevision);
      if (updated.changes !== 1) throw new WorkflowServiceError("workflow revision conflict", 409);
      database
        .prepare(
          `UPDATE workflow_node_attempts SET status = 'stopped', revision = revision + 1, finished_at = ?
           WHERE node_run_id IN (SELECT id FROM workflow_node_runs WHERE workflow_run_id = ?)
             AND status IN ('creating_session', 'dispatching', 'running')`,
        )
        .run(new Date().toISOString(), run.id);
    }
  })();
  return getWorkflow(input.workspaceId)!;
}

export function reattachWorkflow(input: {
  workspaceId: string;
  workflowRunId?: unknown;
  workspaceRevision: unknown;
}): WorkflowView {
  const expectedWorkspaceRevision = requireExpectedRevision(
    input.workspaceRevision,
    "workspaceRevision",
  );
  const database = getDb();
  database.transaction(() => {
    const workspace = getWorkspace(input.workspaceId);
    if (!workspace) throw new WorkflowServiceError("task not found", 404);
    if (workspace.execution_mode !== "standard") {
      throw new WorkflowServiceError("task is not detached", 409);
    }
    if (workspace.revision !== expectedWorkspaceRevision) {
      throw new WorkflowServiceError("workspace revision conflict", 409);
    }
    if (workspaceHasActiveGoalLoop(input.workspaceId)) {
      throw new WorkflowServiceError("Goal Loop is active for this task", 409);
    }
    const run = input.workflowRunId
      ? (database
          .prepare(
            "SELECT * FROM workflow_runs WHERE id = ? AND workspace_id = ? AND status = 'detached'",
          )
          .get(input.workflowRunId, input.workspaceId) as WorkflowRunRow | undefined)
      : (database
          .prepare(
            `SELECT * FROM workflow_runs WHERE workspace_id = ? AND status = 'detached'
             ORDER BY updated_at DESC LIMIT 1`,
          )
          .get(input.workspaceId) as WorkflowRunRow | undefined);
    if (!run) throw new WorkflowServiceError("detached Workflow not found", 404);
    const workspaceUpdate = database
      .prepare(
        `UPDATE workspaces SET execution_mode = 'workflow', revision = revision + 1
         WHERE id = ? AND execution_mode = 'standard' AND revision = ?`,
      )
      .run(input.workspaceId, expectedWorkspaceRevision);
    if (workspaceUpdate.changes !== 1) throw new WorkflowServiceError("workspace revision conflict", 409);
    database
      .prepare(
        `UPDATE workflow_runs SET status = 'paused', pause_reason = 'user', revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'detached'`,
      )
      .run(new Date().toISOString(), run.id);
  })();
  return getWorkflow(input.workspaceId)!;
}

function getNodeRow(workspaceId: string, nodeKey: WorkflowNodeKey): {
  run: WorkflowRunRow;
  node: WorkflowNodeRunRow;
} {
  const run = requireActiveRun(workspaceId);
  const node = getDb()
    .prepare(
      `SELECT n.* FROM workflow_node_runs n
       WHERE n.workflow_run_id = ? AND n.node_key = ?`,
    )
    .get(run.id, nodeKey) as WorkflowNodeRunRow | undefined;
  if (!node) throw new WorkflowServiceError("workflow node not found", 404);
  return { run, node };
}

function parseNodeConfig(value: unknown, nodeKey: WorkflowNodeKey): WorkflowNodeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowServiceError("node config is required", 400);
  }
  const config = value as WorkflowNodeConfig;
  validateWorkflowNodeKind(nodeKey, nodeKey === "implement_ui" ? "implement" : "review");
  assertValidWorkflowNodeConfig(config, nodeKey);
  return config;
}

export function updateWorkflowNode(input: {
  workspaceId: string;
  nodeKey: WorkflowNodeKey;
  config: unknown;
  workflowRevision: unknown;
  nodeRevision: unknown;
}): WorkflowView {
  const { run, node } = getNodeRow(input.workspaceId, input.nodeKey);
  requireWorkflowRevision(run, input.workflowRevision);
  const nodeRevision = requireExpectedRevision(input.nodeRevision, "nodeRevision");
  if (node.revision !== nodeRevision) throw new WorkflowServiceError("node revision conflict", 409);
  const config = parseNodeConfig(input.config, input.nodeKey);
  const database = getDb();
  const now = new Date().toISOString();
  database.transaction(() => {
    const updated = database
      .prepare(
        `UPDATE workflow_node_runs SET config = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
      )
      .run(JSON.stringify(config), now, node.id, nodeRevision);
    if (updated.changes !== 1) throw new WorkflowServiceError("node revision conflict", 409);
    const runUpdated = database
      .prepare(
        `UPDATE workflow_runs SET revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
      )
      .run(now, run.id, input.workflowRevision);
    if (runUpdated.changes !== 1) throw new WorkflowServiceError("workflow revision conflict", 409);
  })();
  return getWorkflow(input.workspaceId)!;
}

function nextAttempt(input: {
  workspaceId: string;
  nodeKey: WorkflowNodeKey;
  workflowRevision: unknown;
}): WorkflowView {
  const { run, node } = getNodeRow(input.workspaceId, input.nodeKey);
  requireWorkflowRevision(run, input.workflowRevision);
  const activeAttempt = getDb()
    .prepare(
      `SELECT 1 FROM workflow_node_attempts
       WHERE node_run_id = ? AND status IN ('creating_session', 'dispatching', 'running')
       LIMIT 1`,
    )
    .get(node.id);
  if (activeAttempt) throw new WorkflowServiceError("node has an in-flight Attempt", 409);
  const attemptNo = node.latest_attempt_no + 1;
  const attemptId = crypto.randomUUID();
  const now = new Date().toISOString();
  const update = getDb()
    .prepare(
      `UPDATE workflow_node_runs
       SET latest_attempt_no = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND workflow_run_id = ?`,
    )
    .run(attemptNo, now, node.id, run.id);
  if (update.changes !== 1) throw new WorkflowServiceError("node revision conflict", 409);
  getDb()
    .prepare(
      `INSERT INTO workflow_node_attempts
       (id, node_run_id, attempt_no, status, config_snapshot, output_mode, dispatch_status)
       VALUES (?, ?, ?, 'ready', ?, ?, 'not_sent')`,
    )
    .run(attemptId, node.id, attemptNo, node.config, "fenced_json");
  getDb()
    .prepare("UPDATE workflow_runs SET revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?")
    .run(now, run.id, input.workflowRevision);
  return getWorkflow(input.workspaceId)!;
}

export function retryWorkflowNode(input: {
  workspaceId: string;
  nodeKey: WorkflowNodeKey;
  workflowRevision: unknown;
}): WorkflowView {
  return nextAttempt(input);
}

export function skipWorkflowNode(input: {
  workspaceId: string;
  nodeKey: WorkflowNodeKey;
  workflowRevision: unknown;
}): WorkflowView {
  const { run, node } = getNodeRow(input.workspaceId, input.nodeKey);
  requireWorkflowRevision(run, input.workflowRevision);
  const config = parseJson(node.config, {}) as WorkflowNodeConfig;
  if (!config.gate?.optional) throw new WorkflowServiceError("required node cannot be skipped", 409);
  const attemptNo = node.latest_attempt_no + 1;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE workflow_node_runs SET latest_attempt_no = ?, revision = revision + 1, updated_at = ? WHERE id = ?`,
    )
    .run(attemptNo, now, node.id);
  const result: ReviewResult = {
    verdict: "skipped",
    summary: "Skipped by user",
    evidence: [],
    findings: [],
  };
  getDb()
    .prepare(
      `INSERT INTO workflow_node_attempts
       (id, node_run_id, attempt_no, status, outcome, result, config_snapshot, output_mode, dispatch_status, finished_at)
       VALUES (?, ?, ?, 'skipped', ?, ?, ?, 'fenced_json', 'not_sent', ?)`,
    )
    .run(
      crypto.randomUUID(),
      node.id,
      attemptNo,
      JSON.stringify({ kind: "review", value: "skipped" }),
      JSON.stringify(result),
      node.config,
      now,
    );
  getDb()
    .prepare("UPDATE workflow_runs SET revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?")
    .run(now, run.id, input.workflowRevision);
  return getWorkflow(input.workspaceId)!;
}

export function isTerminalWorkflowStatus(status: string): boolean {
  return TERMINAL_RUN_STATUSES.includes(status as (typeof TERMINAL_RUN_STATUSES)[number]);
}

export function isInFlightAttemptStatus(status: string): boolean {
  return IN_FLIGHT_ATTEMPT_STATUSES.includes(status as (typeof IN_FLIGHT_ATTEMPT_STATUSES)[number]);
}

export function pauseWorkflowForManualInput(input: {
  workspaceId: string;
  attemptId: string;
  workflowRevision: unknown;
}): WorkflowView {
  const workflow = getWorkflow(input.workspaceId);
  if (!workflow?.run) throw new WorkflowServiceError("workflow not found", 404);
  const expectedRevision = requireExpectedRevision(input.workflowRevision, "workflowRevision");
  if (workflow.run.revision !== expectedRevision) throw new WorkflowServiceError("workflow revision conflict", 409);
  const attempt = getDb().prepare(
    `SELECT a.id FROM workflow_node_attempts a
     JOIN workflow_node_runs n ON n.id = a.node_run_id
     WHERE a.id = ? AND n.workflow_run_id = ? AND a.status = 'running'`,
  ).get(input.attemptId, workflow.run.id);
  if (!attempt) throw new WorkflowServiceError("running Attempt not found", 409);
  const updated = getDb().prepare(
    `UPDATE workflow_runs SET status = 'paused', pause_reason = 'manual_send', revision = revision + 1, updated_at = ?
     WHERE id = ? AND status = 'running' AND revision = ?`,
  ).run(new Date().toISOString(), workflow.run.id, expectedRevision);
  if (updated.changes !== 1) throw new WorkflowServiceError("workflow revision conflict", 409);
  return getWorkflow(input.workspaceId)!;
}
