import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkflowGraphCompat } from "@/lib/workflow-graph-compat";
import { createWorkflowDefinitionSnapshot } from "@/lib/workflow-types";

const mocks = vi.hoisted(() => ({ sendJson: vi.fn() }));
vi.mock("@/lib/workflow-feature-client", () => ({ isWorkflowGraphEditEnabled: () => true }));
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

  it("keeps editing controls compact until they are requested", () => {
    render(
      <WorkflowGraphEditor
        taskId="ws-editor"
        graph={graph}
        selectedNodeId={null}
        selectedEdgeId={null}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        direction="LR"
        defaultExpanded={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Nodeを追加" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "編集を開く" }));
    expect(screen.getByRole("button", { name: "Nodeを追加" })).toBeTruthy();
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
    expect(screen.getByRole("alertdialog").textContent).toContain("接続を削除しますか");
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
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
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect((await screen.findByRole("alert")).textContent).toContain("missing_required_input");

    mocks.sendJson.mockRejectedValueOnce(new ApiError("conflict", 409));
    fireEvent.click(screen.getByRole("button", { name: "選択Nodeを削除" }));
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect((await screen.findByRole("alert")).getAttribute("data-graph-conflict")).toBe("semantic");

    mocks.sendJson.mockRejectedValueOnce(new ApiError("conflict", 409));
    fireEvent.click(screen.getByRole("button", { name: "右へ移動" }));
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

  it("adds a compatible control Edge between reviewer and gate Nodes", async () => {
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
    fireEvent.change(screen.getByRole("combobox", { name: "Edge source" }), { target: { value: "code_review" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Edge target" }), { target: { value: "review_gate" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Edge kind" }), { target: { value: "control" } });
    expect((screen.getByRole("combobox", { name: "Edge kind" }) as HTMLSelectElement).value).toBe("control");
    fireEvent.click(screen.getByRole("button", { name: "接続を追加" }));
    await waitFor(() => expect(mocks.sendJson).toHaveBeenCalledTimes(1));
    expect(mocks.sendJson.mock.calls[0]?.[2].operations).toEqual([
      {
        op: "add_edge",
        edge: expect.objectContaining({
          source: "code_review",
          target: "review_gate",
          sourceHandle: "result",
          targetHandle: "code_review",
          kind: "control",
        }),
      },
    ]);
  });

  it("supports keyboard movement and protects text inputs from Delete", async () => {
    mocks.sendJson.mockResolvedValue({ graph });
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

    const nodeType = screen.getByRole("combobox", { name: "Node type" });
    fireEvent.keyDown(nodeType, { key: "Delete" });
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    await waitFor(() => expect(mocks.sendJson).toHaveBeenCalledTimes(1));
    expect(mocks.sendJson.mock.calls[0]?.[2].operations).toEqual([{
      op: "move_node",
      nodeId: "implement_ui",
      position: { x: graph.nodes[0].position.x + 20, y: graph.nodes[0].position.y },
    }]);

    fireEvent.keyDown(window, { key: "Delete" });
    expect(screen.getByRole("alertdialog").textContent).toContain("Nodeを削除しますか");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
