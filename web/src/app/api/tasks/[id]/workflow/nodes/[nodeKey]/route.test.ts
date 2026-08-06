import { beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  enabled: true,
  updateWorkflowNode: vi.fn(),
}));

vi.mock("@/lib/workflow-feature", () => ({
  isWorkflowModeEnabled: () => mocks.enabled,
}));

vi.mock("@/lib/workflow-service", () => ({
  updateWorkflowNode: mocks.updateWorkflowNode,
  WorkflowServiceError: class WorkflowServiceError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { PATCH } from "./route";

function contextFor(id: string, nodeKey: string) {
  return { params: Promise.resolve({ id, nodeKey }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
});

test("PATCH updates a known node with both workflow and node revisions", async () => {
  mocks.updateWorkflowNode.mockReturnValue({ workspaceId: "ws1" });
  const response = await PATCH(
    new NextRequest("http://localhost/api/tasks/ws1/workflow/nodes/implement_ui", {
      method: "PATCH",
      body: JSON.stringify({
        workflowRevision: 3,
        nodeRevision: 1,
        config: { agentName: "build" },
      }),
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    }),
    contextFor("ws1", "implement_ui"),
  );
  expect(response.status).toBe(200);
  expect(mocks.updateWorkflowNode).toHaveBeenCalledWith({
    workspaceId: "ws1",
    nodeKey: "implement_ui",
    workflowRevision: 3,
    nodeRevision: 1,
    config: { agentName: "build" },
  });
});

test("PATCH rejects unknown nodes before touching the service", async () => {
  const response = await PATCH(
    new NextRequest("http://localhost/api/tasks/ws1/workflow/nodes/unknown", { headers: { host: "127.0.0.1:3000" },
      method: "PATCH",
      body: "{}",
    }),
    contextFor("ws1", "unknown"),
  );
  expect(response.status).toBe(400);
  expect(mocks.updateWorkflowNode).not.toHaveBeenCalled();
});

test("PATCH rejects Control Nodes so their audit records remain server-managed", async () => {
  const response = await PATCH(
    new NextRequest("http://localhost/api/tasks/ws1/workflow/nodes/review_gate", { headers: { host: "127.0.0.1:3000" },
      method: "PATCH",
      body: JSON.stringify({ workflowRevision: 1, nodeRevision: 1, config: {} }),
    }),
    contextFor("ws1", "review_gate"),
  );
  expect(response.status).toBe(400);
  expect(mocks.updateWorkflowNode).not.toHaveBeenCalled();
});
