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

const testDataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-webui-workflow-scheduler-"));
const previousAppData = process.env.APPDATA;
const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDataDir);
process.env.APPDATA = testDataDir;

const { bindSession, createWorkspace, getDb, getWorkspace, upsertProject } = await import("./db");
const { createWorkflow, getWorkflow, updateWorkflow } = await import("./workflow-service");
const { runWorkflowSchedulerTick, stopWorkflowSchedulerForTests } = await import("./workflow-scheduler");

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
    expect(ocServer).toHaveBeenCalledTimes(1);
    expect(ocServer.mock.calls[0]?.[1]).toBe("/session/ses-scheduler-send/prompt_async");

    await runWorkflowSchedulerTick();
    expect(ocServer).toHaveBeenCalledTimes(1);
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
});
