import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, describe, expect, test, vi } from "vitest";
import type { WorkflowNodeConfig } from "./workflow-types";

const testDataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-webui-workflow-service-"));
const previousAppData = process.env.APPDATA;
const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDataDir);
process.env.APPDATA = testDataDir;

const {
  bindSession,
  createWorkspace,
  getDb,
  getWorkspace,
  upsertProject,
} = await import("./db");
const {
  createWorkflow,
  getWorkflow,
  reattachWorkflow,
  retryWorkflowNode,
  stopActiveWorkflowForArchive,
  updateWorkflow,
  updateWorkflowNode,
  WorkflowServiceError,
} = await import("./workflow-service");
const { recordReviewGateAttempt } = await import("./workflow-control");
const { getOrMaterializeWorkflowGraph } = await import("./workflow-graph-repository");

afterAll(() => {
  getDb().close();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  homedirSpy.mockRestore();
  rmSync(testDataDir, { recursive: true, force: true });
});

function setupWorkspace(id: string, sessionId: string): number {
  const project = upsertProject({
    name: `Project ${id}`,
    rootPath: path.join(testDataDir, id),
  });
  createWorkspace({
    id,
    projectId: project.id,
    displayName: id,
    absolutePath: testDataDir,
    isolation: "current_folder",
  });
  bindSession(id, sessionId, "Implement");
  return getWorkspace(id)!.revision;
}

describe("workflow service", () => {
  test("converts a standard task and binds the existing primary session", () => {
    const workspaceRevision = setupWorkspace("ws-convert", "ses-implement");
    const workflow = createWorkflow({
      workspaceId: "ws-convert",
      workspaceRevision,
      taskContext: {
        goal: "Build the UI",
        acceptance: ["It works"],
        constraints: ["Keep the API stable"],
      },
    });
    expect(workflow.executionMode).toBe("workflow");
    expect(workflow.run?.status).toBe("ready");
    expect(workflow.run?.taskContextSnapshot.goal).toBe("Build the UI");
    const implement = workflow.nodes.find((node) => node.nodeKey === "implement_ui");
    expect(implement?.attempts[0]).toMatchObject({
      attemptNo: 1,
      status: "ready",
      opencodeSessionId: "ses-implement",
    });
    expect(workflow.nodes.find((node) => node.nodeKey === "code_review")?.attempts).toEqual([]);
    expect(workflow.nodes.find((node) => node.nodeKey === "review_gate")).toMatchObject({
      kind: "control",
      latestAttemptNo: 0,
      attempts: [],
    });
  });

  test("records a Review Gate decision as a control Attempt without a Session", () => {
    const workspaceRevision = setupWorkspace("ws-control-audit", "ses-control");
    const created = createWorkflow({
      workspaceId: "ws-control-audit",
      workspaceRevision,
      taskContext: { goal: "goal", acceptance: [], constraints: [] },
    });
    const attemptId = recordReviewGateAttempt({
      workflowRunId: created.run!.id,
      reviewers: [
        { attemptId: "review-attempt", nodeKey: "code_review", status: "succeeded", result: { verdict: "pass" } },
        { attemptId: "visual-attempt", nodeKey: "visual_judge", status: "succeeded", result: { verdict: "pass" } },
      ],
      decision: { decision: "pass" },
      now: "2026-08-02T02:00:00.000Z",
    });

    const control = getWorkflow("ws-control-audit")?.nodes.find((node) => node.nodeKey === "review_gate");
    expect(attemptId).toEqual(expect.any(String));
    expect(control).toMatchObject({ kind: "control", latestAttemptNo: 1 });
    expect(control?.attempts[0]).toMatchObject({
      attemptNo: 1,
      status: "succeeded",
      opencodeSessionId: null,
      dispatchStatus: "control_evaluated",
      inputHash: expect.stringMatching(/^sha256:/),
      startedAt: "2026-08-02T02:00:00.000Z",
      finishedAt: "2026-08-02T02:00:00.000Z",
    });
    expect(control?.attempts[0]?.result).toEqual({ decision: "pass" });
  });

  test("rejects stale conversion and active Goal Loop conversion", () => {
    const workspaceRevision = setupWorkspace("ws-stale", "ses-stale");
    expect(() =>
      createWorkflow({
        workspaceId: "ws-stale",
        workspaceRevision: workspaceRevision - 1,
        taskContext: { goal: "goal", acceptance: [], constraints: [] },
      }),
    ).toThrowError(WorkflowServiceError);

    const queuedRevision = setupWorkspace("ws-goal-loop", "ses-loop");
    getDb()
      .prepare(
        `INSERT INTO goal_loops
         (id, workspace_id, opencode_session_id, status, goal, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
      )
      .run(
        "loop-1",
        "ws-goal-loop",
        "ses-loop",
        "existing goal",
        "2026-07-22T00:00:00.000Z",
        "2026-07-22T00:00:00.000Z",
      );
    expect(() =>
      createWorkflow({
        workspaceId: "ws-goal-loop",
        workspaceRevision: queuedRevision,
        taskContext: { goal: "goal", acceptance: [], constraints: [] },
      }),
    ).toThrowError(WorkflowServiceError);
  });

  test("uses CAS for start, pause, detach, and reattach", () => {
    const workspaceRevision = setupWorkspace("ws-lifecycle", "ses-lifecycle");
    const created = createWorkflow({
      workspaceId: "ws-lifecycle",
      workspaceRevision,
      taskContext: { goal: "goal", acceptance: [], constraints: [] },
    });
    expect(created.run?.revision).toBe(0);
    const running = updateWorkflow({
      workspaceId: "ws-lifecycle",
      action: "start",
      workflowRevision: 0,
    });
    expect(running.run?.status).toBe("running");
    expect(() =>
      updateWorkflow({ workspaceId: "ws-lifecycle", action: "start", workflowRevision: 0 }),
    ).toThrowError(WorkflowServiceError);
    const paused = updateWorkflow({
      workspaceId: "ws-lifecycle",
      action: "pause",
      workflowRevision: 1,
    });
    expect(paused.run?.status).toBe("paused");
    const detached = updateWorkflow({
      workspaceId: "ws-lifecycle",
      action: "detach",
      workflowRevision: 2,
      workspaceRevision: workspaceRevision + 1,
    });
    expect(detached.executionMode).toBe("standard");
    expect(detached.run?.status).toBe("detached");
    const reattached = reattachWorkflow({
      workspaceId: "ws-lifecycle",
      workspaceRevision: workspaceRevision + 2,
    });
    expect(reattached.executionMode).toBe("workflow");
    expect(reattached.run?.status).toBe("paused");
  });

  test("publishes the Graph Draft as an immutable v2 Execution Snapshot at Run start", () => {
    const workspaceRevision = setupWorkspace("ws-snapshot-start", "ses-snapshot-start");
    const created = createWorkflow({
      workspaceId: "ws-snapshot-start",
      workspaceRevision,
      taskContext: { goal: "goal", acceptance: [], constraints: [] },
    });
    const draft = getOrMaterializeWorkflowGraph("ws-snapshot-start")!;
    const started = updateWorkflow({
      workspaceId: "ws-snapshot-start",
      action: "start",
      workflowRevision: created.run!.revision,
      workspaceRevision: created.workspaceRevision,
    });
    expect(started.run?.definitionSnapshot).toMatchObject({
      schemaVersion: "workflow-execution-v2",
      sourceGraphId: draft.id,
      sourceGraphRevision: draft.graphRevision,
    });
    expect((started.run?.definitionSnapshot as { presentation?: unknown }).presentation).toBeDefined();
    expect(started.run?.status).toBe("running");
  });

  test("updates node config and creates a new retry attempt without overwriting history", () => {
    const workspaceRevision = setupWorkspace("ws-retry", "ses-retry");
    const created = createWorkflow({
      workspaceId: "ws-retry",
      workspaceRevision,
      taskContext: { goal: "goal", acceptance: [], constraints: [] },
    });
    const implement = created.nodes.find((node) => node.nodeKey === "implement_ui")!;
    const updated = updateWorkflowNode({
      workspaceId: "ws-retry",
      nodeKey: "implement_ui",
      workflowRevision: 0,
      nodeRevision: implement.revision,
      config: {
        ...(implement.config as WorkflowNodeConfig),
        instructions: "Next attempt only",
      },
    });
    const retried = retryWorkflowNode({
      workspaceId: "ws-retry",
      nodeKey: "implement_ui",
      workflowRevision: updated.run!.revision,
    });
    const attempts = retried.nodes.find((node) => node.nodeKey === "implement_ui")!.attempts;
    expect(attempts.map((attempt) => attempt.attemptNo)).toEqual([1, 2]);
    expect(attempts[0]?.configSnapshot).not.toEqual(attempts[1]?.configSnapshot);
  });

  test("reports active workflow for operation exclusion", () => {
    const workspaceRevision = setupWorkspace("ws-active", "ses-active");
    createWorkflow({
      workspaceId: "ws-active",
      workspaceRevision,
      taskContext: { goal: "goal", acceptance: [], constraints: [] },
    });
    expect(getWorkflow("ws-active")?.executionMode).toBe("workflow");
    expect(() => updateWorkflow({ workspaceId: "ws-active", action: "stop", workflowRevision: 0 })).not.toThrow();
    expect(getWorkflow("ws-active")?.run?.status).toBe("stopped");
    expect(() =>
      updateWorkflow({ workspaceId: "missing", action: "stop", workflowRevision: 0 }),
    ).toThrow(WorkflowServiceError);
  });

  test("stops an active workflow when archiving is explicitly requested", () => {
    const workspaceRevision = setupWorkspace("ws-archive-active", "ses-archive-active");
    createWorkflow({
      workspaceId: "ws-archive-active",
      workspaceRevision,
      taskContext: { goal: "goal", acceptance: [], constraints: [] },
    });

    expect(() => stopActiveWorkflowForArchive("ws-archive-active")).not.toThrow();
    expect(getWorkflow("ws-archive-active")?.run?.status).toBe("stopped");
    expect(() => stopActiveWorkflowForArchive("ws-archive-active")).not.toThrow();
  });
});
