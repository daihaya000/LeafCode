import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  editEnabled: true,
  graph: { id: "graph-1", workspaceId: "ws1", graphRevision: 2 },
  getOrMaterialize: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/workflow-feature", () => ({
  isWorkflowGraphEditEnabled: () => mocks.editEnabled,
}));

vi.mock("@/lib/workflow-graph-repository", () => ({
  getOrMaterializeWorkflowGraph: mocks.getOrMaterialize,
}));

vi.mock("@/lib/workflow-graph-mutations", () => ({
  updateWorkflowGraph: mocks.update,
  isGraphMutationError: (error: unknown) => Boolean(error && typeof error === "object" && "code" in error),
}));

import { GET, PATCH } from "./route";

function contextFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.editEnabled = true;
  mocks.getOrMaterialize.mockReturnValue(mocks.graph);
  mocks.update.mockReturnValue(mocks.graph);
});

describe("/api/tasks/[id]/workflow/graph", () => {
  it("returns a lazily materialized graph draft", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/tasks/ws1/workflow/graph"),
      contextFor("ws1"),
    );
    expect(response.status).toBe(200);
    expect(mocks.getOrMaterialize).toHaveBeenCalledWith("ws1");
    expect(await response.json()).toEqual({ graph: mocks.graph });
  });

  it("requires the edit flag and forwards Graph CAS operations", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/ws1/workflow/graph", {
        method: "PATCH",
        body: JSON.stringify({ expectedGraphRevision: 2, operations: [{ op: "move_node" }] }),
        headers: { "content-type": "application/json" },
      }),
      contextFor("ws1"),
    );
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      workspaceId: "ws1",
      expectedGraphRevision: 2,
      operations: [{ op: "move_node" }],
    });

    mocks.editEnabled = false;
    const disabled = await PATCH(
      new Request("http://localhost/api/tasks/ws1/workflow/graph", { method: "PATCH" }),
      contextFor("ws1"),
    );
    expect(disabled.status).toBe(409);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("returns the latest graph for a CAS conflict", async () => {
    mocks.update.mockImplementation(() => {
      throw Object.assign(new Error("conflict"), { code: "revision_conflict", latestGraph: mocks.graph });
    });
    const response = await PATCH(
      new Request("http://localhost/api/tasks/ws1/workflow/graph", {
        method: "PATCH",
        body: JSON.stringify({ expectedGraphRevision: 1, operations: [{ op: "update_node_config", nodeId: "implement_ui", config: {} }] }),
      }),
      contextFor("ws1"),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "conflict", conflictKind: "semantic", graph: mocks.graph });
  });

  it("classifies layout-only CAS conflicts separately", async () => {
    mocks.update.mockImplementation(() => {
      throw Object.assign(new Error("conflict"), { code: "revision_conflict", latestGraph: mocks.graph });
    });
    const response = await PATCH(
      new Request("http://localhost/api/tasks/ws1/workflow/graph", {
        method: "PATCH",
        body: JSON.stringify({ expectedGraphRevision: 1, operations: [{ op: "move_node", nodeId: "implement_ui", position: { x: 1, y: 2 } }] }),
      }),
      contextFor("ws1"),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).conflictKind).toBe("layout");
  });
});
