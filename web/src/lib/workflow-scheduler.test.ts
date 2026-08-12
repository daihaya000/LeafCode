import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

const { ocServer, runGit } = vi.hoisted(() => ({
  ocServer: vi.fn(),
  runGit: vi.fn(),
}));

vi.mock("./oc-server", () => ({
  ocServer,
  OcError: class OcError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
}));
vi.mock("./git", () => ({ runGit }));
vi.mock("./collaboration-context", () => ({
  collaborationContextFor: vi.fn(async () => ""),
  prependCollaborationContext: vi.fn((body: Record<string, unknown>) => body),
}));

const testDataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-webui-workflow-scheduler-"));
const previousAppData = process.env.APPDATA;
const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDataDir);
process.env.APPDATA = testDataDir;

const { bindSession, createWorkspace, getDb, getWorkspace, upsertProject } = await import("./db");
const { createWorkflow, getWorkflow, updateWorkflow } = await import("./workflow-service");
const { getOrMaterializeWorkflowGraph } = await import("./workflow-graph-repository");
const { advanceReviewGate, runWorkflowSchedulerTick, startWorkflowScheduler, stopWorkflowSchedulerForTests } = await import("./workflow-scheduler");

afterAll(() => {
  stopWorkflowSchedulerForTests();
  getDb().close();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  homedirSpy.mockRestore();
  rmSync(testDataDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENCODE_WEBUI_WORKFLOW_MODE", "true");
  ocServer.mockResolvedValue(undefined);
  runGit.mockImplementation(async (_directory: string, args: string[]) =>
    args[0] === "rev-parse"
      ? { code: 0, stdout: "abc123\n", stderr: "" }
      : { code: 0, stdout: " M src/App.tsx\n", stderr: "" },
  );
});

function setup(id: string): number {
  const project = upsertProject({ name: id, rootPath: path.join(testDataDir, id) });
  createWorkspace({
    id,
    projectId: project.id,
    displayName: id,
    absolutePath: testDataDir,
    isolation: "current_folder",
  });
  bindSession(id, `ses-${id}`, "Implement");
  return getWorkspace(id)!.revision;
}

describe("workflow scheduler", () => {
  test("claims and dispatches one ready Attempt exactly once", async () => {
    const revision = setup("scheduler-send");
    createWorkflow({
      workspaceId: "scheduler-send",
      workspaceRevision: revision,
      taskContext: { goal: "Build UI", acceptance: [], constraints: [] },
    });
    updateWorkflow({ workspaceId: "scheduler-send", action: "start", workflowRevision: 0 });

    await runWorkflowSchedulerTick();
    const workflow = getWorkflow("scheduler-send")!;
    const attempt = workflow.nodes.find((node) => node.nodeKey === "implement_ui")!.attempts[0]!;
    expect(attempt.status).toBe("running");
    expect(attempt.dispatchStatus).toBe("awaiting_result");
    expect(attempt.promptMarker).toContain("workflow-");
    expect(attempt.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(ocServer).toHaveBeenCalledTimes(2);
    expect(ocServer.mock.calls[1]?.[1]).toBe("/session/ses-scheduler-send/prompt_async");

    await runWorkflowSchedulerTick();
    expect(ocServer).toHaveBeenCalledTimes(3);
    expect(ocServer.mock.calls[2]?.[1]).toBe("/session/ses-scheduler-send/message");
    updateWorkflow({
      workspaceId: "scheduler-send",
      action: "stop",
      workflowRevision: getWorkflow("scheduler-send")!.run!.revision,
    });
  });

  test("pauses on ambiguous delivery without retrying", async () => {
    const revision = setup("scheduler-unknown");
    createWorkflow({
      workspaceId: "scheduler-unknown",
      workspaceRevision: revision,
      taskContext: { goal: "Build UI", acceptance: [], constraints: [] },
    });
    updateWorkflow({ workspaceId: "scheduler-unknown", action: "start", workflowRevision: 0 });
    ocServer.mockRejectedValueOnce(new Error("network timeout"));

    await runWorkflowSchedulerTick();
    const workflow = getWorkflow("scheduler-unknown")!;
    const attempt = workflow.nodes.find((node) => node.nodeKey === "implement_ui")!.attempts[0]!;
    expect(attempt.status).toBe("failed");
    expect(workflow.run?.status).toBe("paused");
    expect(workflow.run?.pauseReason).toBe("unknown_delivery");
    expect(ocServer).toHaveBeenCalledTimes(1);
    await runWorkflowSchedulerTick();
    expect(ocServer).toHaveBeenCalledTimes(1);
  });

  test("reads only the post-dispatch result and stores usage snapshot", async () => {
    const revision = setup("scheduler-usage");
    createWorkflow({
      workspaceId: "scheduler-usage",
      workspaceRevision: revision,
      taskContext: { goal: "Build UI", acceptance: [], constraints: [] },
    });
    updateWorkflow({ workspaceId: "scheduler-usage", action: "start", workflowRevision: 0 });
    ocServer.mockResolvedValueOnce(undefined);
    await runWorkflowSchedulerTick();
    const attempt = getWorkflow("scheduler-usage")!.nodes.find((node) => node.nodeKey === "implement_ui")!.attempts[0]!;
    getDb().prepare("UPDATE workflow_node_attempts SET last_message_id = 'old' WHERE id = ?").run(attempt.id);
    ocServer.mockResolvedValueOnce([
      { info: { id: "old", role: "assistant", time: { completed: 1 }, tokens: { total: 1, input: 1, output: 0, reasoning: 0 } }, parts: [{ type: "text", text: "old" }] },
      { info: { id: "result-1", role: "assistant", time: { created: 10, completed: 30 }, cost: 0.25, tokens: { total: 12, input: 4, output: 6, reasoning: 2 } }, parts: [{ type: "text", text: `<!-- webui-workflow-result:${attempt.promptMarker} -->\n\`\`\`json\n{"status":"progress","summary":"partial","evidence":[]}\n\`\`\`` }] },
    ]);
    await runWorkflowSchedulerTick();
    const updated = getWorkflow("scheduler-usage")!.nodes.find((node) => node.nodeKey === "implement_ui")!.attempts[0]!;
    expect(updated.status).toBe("succeeded");
    expect(updated.lastMessageId).toBe("result-1");
    expect(updated.usageSnapshot).toMatchObject({ tokens: 12, cost: 0.25, durationMs: 20 });
    updateWorkflow({ workspaceId: "scheduler-usage", action: "stop", workflowRevision: getWorkflow("scheduler-usage")!.run!.revision });
  });

  test("finalizes pause_requested to paused after the in-flight Attempt result is saved", async () => {
    const revision = setup("scheduler-pause-inflight");
    createWorkflow({
      workspaceId: "scheduler-pause-inflight",
      workspaceRevision: revision,
      taskContext: { goal: "Build UI", acceptance: [], constraints: [] },
    });
    updateWorkflow({
      workspaceId: "scheduler-pause-inflight",
      action: "start",
      workflowRevision: 0,
    });
    ocServer.mockResolvedValueOnce(undefined);
    await runWorkflowSchedulerTick();

    const before = getWorkflow("scheduler-pause-inflight")!;
    const attempt = before.nodes.find((node) => node.nodeKey === "implement_ui")!.attempts[0]!;
    expect(attempt.status).toBe("running");
    expect(before.run?.status).toBe("running");

    const paused = updateWorkflow({
      workspaceId: "scheduler-pause-inflight",
      action: "pause",
      workflowRevision: before.run!.revision,
    });
    expect(paused.run?.status).toBe("pause_requested");

    ocServer.mockResolvedValueOnce([
      {
        info: {
          id: "result-1",
          role: "assistant",
          time: { created: 10, completed: 30 },
          tokens: { total: 4, input: 2, output: 2, reasoning: 0 },
        },
        parts: [
          {
            type: "text",
            text: `<!-- webui-workflow-result:${attempt.promptMarker} -->\n\`\`\`json\n{"status":"progress","summary":"paused mid-flight","evidence":[]}\n\`\`\``,
          },
        ],
      },
    ]);
    await runWorkflowSchedulerTick();

    const after = getWorkflow("scheduler-pause-inflight")!;
    const finished = after.nodes.find((node) => node.nodeKey === "implement_ui")!.attempts[0]!;
    expect(finished.status).toBe("succeeded");
    expect(after.run?.status).toBe("paused");
    expect(after.run?.pauseReason).toBe("user");

    updateWorkflow({
      workspaceId: "scheduler-pause-inflight",
      action: "resume",
      workflowRevision: after.run!.revision,
    });
    expect(getWorkflow("scheduler-pause-inflight")!.run?.status).toBe("running");
  });

  test("pauses interrupted dispatches on scheduler restart", async () => {
    const revision = setup("scheduler-restart");
    createWorkflow({ workspaceId: "scheduler-restart", workspaceRevision: revision, taskContext: { goal: "Build UI", acceptance: [], constraints: [] } });
    updateWorkflow({ workspaceId: "scheduler-restart", action: "start", workflowRevision: 0 });
    getDb().prepare("UPDATE workflow_node_attempts SET status = 'dispatching' WHERE id = (SELECT a.id FROM workflow_node_attempts a JOIN workflow_node_runs n ON n.id = a.node_run_id WHERE n.workflow_run_id = (SELECT id FROM workflow_runs WHERE workspace_id = ?))").run("scheduler-restart");
    startWorkflowScheduler();
    expect(getWorkflow("scheduler-restart")!.run?.pauseReason).toBe("scheduler_restart");
    stopWorkflowSchedulerForTests();
  });

  test("records a server-managed Review Gate Attempt when reviewers finish", async () => {
    const revision = setup("scheduler-control-audit");
    createWorkflow({
      workspaceId: "scheduler-control-audit",
      workspaceRevision: revision,
      taskContext: { goal: "Build UI", acceptance: [], constraints: [] },
    });
    updateWorkflow({ workspaceId: "scheduler-control-audit", action: "start", workflowRevision: 0 });
    const workflow = getWorkflow("scheduler-control-audit")!;
    const runId = workflow.run!.id;
    for (const nodeKey of ["code_review", "visual_judge"] as const) {
      const node = workflow.nodes.find((candidate) => candidate.nodeKey === nodeKey)!;
      getDb()
        .prepare("UPDATE workflow_node_runs SET latest_attempt_no = 1 WHERE id = ?")
        .run(node.id);
      getDb()
        .prepare(
          `INSERT INTO workflow_node_attempts
           (id, node_run_id, attempt_no, status, result, config_snapshot, output_mode, dispatch_status)
           VALUES (?, ?, 1, 'succeeded', ?, ?, 'fenced_json', 'result_received')`,
        )
        .run(
          `attempt-${nodeKey}`,
          node.id,
          JSON.stringify({ verdict: "pass", summary: "ok", evidence: [], findings: [] }),
          JSON.stringify(node.config),
        );
    }
    await advanceReviewGate(runId);
    const updated = getWorkflow("scheduler-control-audit")!;
    const gate = updated.nodes.find((node) => node.nodeKey === "review_gate")!;
    expect(gate.attempts[0]).toMatchObject({
      status: "succeeded",
      opencodeSessionId: null,
      dispatchStatus: "control_evaluated",
      result: { decision: "pass" },
    });
    expect(updated.run?.status).toBe("completed");
  });

  test("pauses the run when result processing throws instead of aborting the tick", async () => {
    const revision = setup("scheduler-throw");
    createWorkflow({
      workspaceId: "scheduler-throw",
      workspaceRevision: revision,
      taskContext: { goal: "Build UI", acceptance: [], constraints: [] },
    });
    updateWorkflow({ workspaceId: "scheduler-throw", action: "start", workflowRevision: 0 });
    await runWorkflowSchedulerTick();
    const attempt = getWorkflow("scheduler-throw")!.nodes.find((node) => node.nodeKey === "implement_ui")!.attempts[0]!;
    expect(attempt.status).toBe("running");

    ocServer.mockImplementation(async (_dir: string, requestPath: string) => {
      if (typeof requestPath === "string" && requestPath.endsWith("/message")) {
        return [
          {
            info: { id: "result-1", role: "assistant", time: { created: 10, completed: 30 } },
            parts: [{ type: "text", text: `<!-- webui-workflow-result:${attempt.promptMarker} -->\n\`\`\`json\n{"status":"completed","summary":"done","evidence":[]}\n\`\`\`` }],
          },
        ];
      }
      throw new Error("engine unavailable");
    });
    await runWorkflowSchedulerTick();

    const workflow = getWorkflow("scheduler-throw")!;
    const updated = workflow.nodes.find((node) => node.nodeKey === "implement_ui")!.attempts[0]!;
    expect(updated.status).toBe("succeeded");
    expect(workflow.run?.status).toBe("paused");
    expect(workflow.run?.pauseReason).toBe("scheduler_error");
  });

  test("dispatches a v2 Run through the snapshot Executor Registry", async () => {
    const revision = setup("scheduler-v2-executor");
    const created = createWorkflow({
      workspaceId: "scheduler-v2-executor",
      workspaceRevision: revision,
      taskContext: { goal: "Build UI", acceptance: [], constraints: [] },
    });
    getOrMaterializeWorkflowGraph("scheduler-v2-executor");
    updateWorkflow({
      workspaceId: "scheduler-v2-executor",
      action: "start",
      workflowRevision: created.run!.revision,
      workspaceRevision: created.workspaceRevision,
    });
    await runWorkflowSchedulerTick();
    const attempt = getWorkflow("scheduler-v2-executor")!.nodes.find((node) => node.nodeKey === "implement_ui")!.attempts[0]!;
    expect(attempt.status).toBe("running");
    expect(ocServer).toHaveBeenCalledWith(expect.any(String), "/session/ses-scheduler-v2-executor/prompt_async", expect.any(Object));
  });
});
