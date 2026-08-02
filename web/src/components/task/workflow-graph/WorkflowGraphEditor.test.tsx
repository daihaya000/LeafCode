import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkflowGraphCompat } from "@/lib/workflow-graph-compat";
import { createWorkflowDefinitionSnapshot } from "@/lib/workflow-types";

const mocks = vi.hoisted(() => ({ sendJson: vi.fn() }));
vi.mock("@/lib/workflow-feature", () => ({ isWorkflowGraphEditEnabled: () => true }));
vi.mock("@/lib/client", () => ({
  sendJson: mocks.sendJson,
  ApiError: class ApiError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
}));

import { WorkflowGraphEditor } from "./WorkflowGraphEditor";

const graph = createWorkflowGraphCompat(createWorkflowDefinitionSnapshot(), {
  id: "graph-editor",
  workspaceId: "ws-editor",
});

describe("WorkflowGraphEditor", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("adds a supported Node with a connection and deletes a selected Edge", async () => {
    mocks.sendJson.mockResolvedValue({ graph });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkflowGraphEditor
        taskId="ws-editor"
        graph={graph}
        selectedNodeId={null}
        selectedEdgeId="implement_ui-to-code_review"
        onRefresh={onRefresh}
        direction="LR"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Nodeを追加" }));
    await waitFor(() => expect(mocks.sendJson).toHaveBeenCalledWith(
      "PATCH",
      "/api/tasks/ws-editor/workflow/graph",
      expect.objectContaining({ expectedGraphRevision: graph.graphRevision, operations: expect.any(Array) }),
    ));
    expect(mocks.sendJson.mock.calls[0]?.[2].operations).toHaveLength(2);
    expect(mocks.sendJson.mock.calls[0]?.[2].operations[1]).toMatchObject({
      op: "add_edge",
      edge: { sourceHandle: "result", targetHandle: "implementation", kind: "dependency" },
    });

    fireEvent.click(screen.getByRole("button", { name: "選択Edgeを削除" }));
    await waitFor(() => expect(mocks.sendJson).toHaveBeenCalledTimes(2));
    expect(mocks.sendJson.mock.calls[1]?.[2].operations).toEqual([{ op: "remove_edge", edgeId: "implement_ui-to-code_review" }]);
  });

  it("shows validation errors and distinguishes semantic/layout CAS conflicts", async () => {
    const { ApiError } = await import("@/lib/client");
    mocks.sendJson.mockRejectedValueOnce(new Error("Graph mutation failed validation: missing_required_input"));
    render(
      <WorkflowGraphEditor
        taskId="ws-editor"
        graph={graph}
        selectedNodeId="implement_ui"
        selectedEdgeId={null}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        direction="LR"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "選択Nodeを削除" }));
    expect((await screen.findByRole("alert")).textContent).toContain("missing_required_input");

    mocks.sendJson.mockRejectedValueOnce(new ApiError("conflict", 409));
    fireEvent.click(screen.getByRole("button", { name: "選択Nodeを削除" }));
    expect((await screen.findByRole("alert")).getAttribute("data-graph-conflict")).toBe("semantic");

    mocks.sendJson.mockRejectedValueOnce(new ApiError("conflict", 409));
    fireEvent.click(screen.getByRole("button", { name: "選択Nodeを移動" }));
    expect((await screen.findByRole("alert")).getAttribute("data-graph-conflict")).toBe("layout");
  });

  it("persists the Dagre layout as layout-only operations", async () => {
    mocks.sendJson.mockResolvedValue({ graph });
    render(
      <WorkflowGraphEditor
        taskId="ws-editor"
        graph={graph}
        selectedNodeId={null}
        selectedEdgeId={null}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        direction="TB"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "自動レイアウト（TB）" }));
    await waitFor(() => expect(mocks.sendJson).toHaveBeenCalledTimes(1));
    const operations = mocks.sendJson.mock.calls[0]?.[2].operations as Array<{ op: string }>;
    expect(operations).toHaveLength(graph.nodes.length);
    expect(operations.every((operation) => operation.op === "move_node")).toBe(true);
  });

  it("adds the selected registry Node type with compatible ports", async () => {
    mocks.sendJson.mockResolvedValue({ graph });
    render(
      <WorkflowGraphEditor
        taskId="ws-editor"
        graph={graph}
        selectedNodeId={null}
        selectedEdgeId={null}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        direction="LR"
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Node type" }), { target: { value: "opencode.visual_judge" } });
    fireEvent.click(screen.getByRole("button", { name: "Nodeを追加" }));
    await waitFor(() => expect(mocks.sendJson).toHaveBeenCalledTimes(1));
    expect(mocks.sendJson.mock.calls[0]?.[2].operations[1]).toMatchObject({
      op: "add_edge",
      edge: { sourceHandle: "result", targetHandle: "implementation" },
    });
  });
});
