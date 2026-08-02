import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  enabled: true,
  createWorkflow: vi.fn(),
  getWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  reattachWorkflow: vi.fn(),
}));

vi.mock("@/lib/workflow-feature", () => ({
  isWorkflowModeEnabled: () => mocks.enabled,
}));

vi.mock("@/lib/workflow-service", () => ({
  createWorkflow: mocks.createWorkflow,
  getWorkflow: mocks.getWorkflow,
  updateWorkflow: mocks.updateWorkflow,
  reattachWorkflow: mocks.reattachWorkflow,
  WorkflowServiceError: class WorkflowServiceError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { GET, PATCH, POST } from "./route";

function contextFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
});

describe("/api/tasks/[id]/workflow", () => {
  it("returns the current workflow DTO", async () => {
    mocks.getWorkflow.mockReturnValue({ workspaceId: "ws1", run: null, nodes: [] });
    const response = await GET(
      new NextRequest("http://localhost/api/tasks/ws1/workflow"),
      contextFor("ws1"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      workflow: { workspaceId: "ws1", run: null, nodes: [] },
    });
  });

  it("converts a standard task only when the feature is enabled", async () => {
    mocks.createWorkflow.mockReturnValue({ workspaceId: "ws1", run: { status: "ready" } });
    const response = await POST(
      new NextRequest("http://localhost/api/tasks/ws1/workflow", {
        method: "POST",
        body: JSON.stringify({
          workspaceRevision: 4,
          goal: "Build UI",
          acceptance: ["renders"],
          constraints: [],
        }),
        headers: { "content-type": "application/json" },
      }),
      contextFor("ws1"),
    );
    expect(response.status).toBe(201);
    expect(mocks.createWorkflow).toHaveBeenCalledWith({
      workspaceId: "ws1",
      workspaceRevision: 4,
      taskContext: { goal: "Build UI", acceptance: ["renders"], constraints: [] },
    });

    mocks.enabled = false;
    const disabled = await POST(
      new NextRequest("http://localhost/api/tasks/ws1/workflow", { method: "POST" }),
      contextFor("ws1"),
    );
    expect(disabled.status).toBe(409);
    expect(mocks.createWorkflow).toHaveBeenCalledTimes(1);
  });

  it("allows stop while disabled but blocks start/resume", async () => {
    mocks.enabled = false;
    mocks.updateWorkflow.mockReturnValue({ workspaceId: "ws1", run: { status: "stopped" } });
    const stop = await PATCH(
      new NextRequest("http://localhost/api/tasks/ws1/workflow", {
        method: "PATCH",
        body: JSON.stringify({ action: "stop", workflowRevision: 2 }),
        headers: { "content-type": "application/json" },
      }),
      contextFor("ws1"),
    );
    expect(stop.status).toBe(200);
    const start = await PATCH(
      new NextRequest("http://localhost/api/tasks/ws1/workflow", {
        method: "PATCH",
        body: JSON.stringify({ action: "start", workflowRevision: 2 }),
        headers: { "content-type": "application/json" },
      }),
      contextFor("ws1"),
    );
    expect(start.status).toBe(409);
    expect(mocks.updateWorkflow).toHaveBeenCalledTimes(1);
  });
});
