import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowGraphDraft } from "@/lib/workflow-graph-types";
import { WorkflowGraphList } from "./WorkflowGraphList";

const graph = {
  id: "graph-1",
  workspaceId: "ws1",
  schemaVersion: "workflow-graph-v1",
  graphRevision: 1,
  registryVersion: "workflow-registry-v1",
  nodes: [{ id: "implement_ui", type: "opencode.implement_ui", typeVersion: 1, label: "Implement UI", position: { x: 0, y: 0 }, config: {}, disabled: false }],
  edges: [],
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
} as WorkflowGraphDraft;

describe("WorkflowGraphList", () => {
  it("keeps Node selection keyboard reachable and avoids wide content", () => {
    const onSelectNode = vi.fn();
    const onSelectEdge = vi.fn();
    render(
      <WorkflowGraphList
        graph={graph}
        states={[{ nodeId: "implement_ui", status: "ready", attemptNo: 0 }]}
        selectedNodeId={null}
        onSelectNode={onSelectNode}
        selectedEdgeId={null}
        onSelectEdge={onSelectEdge}
      />,
    );
    const button = screen.getByRole("button", { name: /Implement UI/ });
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Enter Space");
    expect(button.getAttribute("data-node-id")).toBe("implement_ui");
    fireEvent.click(button);
    expect(onSelectEdge).toHaveBeenCalledWith(null);
    expect(onSelectNode).toHaveBeenCalledWith("implement_ui");
    expect(screen.getByRole("complementary").classList.contains("min-w-0")).toBe(true);
    expect(screen.getByText("接続はありません。")).toBeTruthy();
  });

  it("exposes disabled Nodes without relying on color", () => {
    render(
      <WorkflowGraphList
        graph={{ ...graph, nodes: [{ ...graph.nodes[0], disabled: true }] }}
        states={[{ nodeId: "implement_ui", status: "ready", attemptNo: 0 }]}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        selectedEdgeId={null}
        onSelectEdge={vi.fn()}
      />,
    );
    expect(screen.getByText("無効")).toBeTruthy();
  });
});
