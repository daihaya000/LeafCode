import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
} as never;

describe("WorkflowGraphList", () => {
  it("keeps Node selection keyboard reachable and avoids wide content", () => {
    const onSelectNode = vi.fn();
    render(
      <WorkflowGraphList
        graph={graph}
        states={[{ nodeId: "implement_ui", status: "ready", attemptNo: 0 }]}
        selectedNodeId={null}
        onSelectNode={onSelectNode}
        selectedEdgeId={null}
        onSelectEdge={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: /Implement UI/ });
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Enter Space");
    expect(button.getAttribute("data-node-id")).toBe("implement_ui");
    fireEvent.click(button);
    expect(onSelectNode).toHaveBeenCalledWith("implement_ui");
    expect(screen.getByRole("complementary").classList.contains("min-w-0")).toBe(true);
  });
});
