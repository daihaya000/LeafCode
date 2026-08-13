import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { WorkflowGraphCanvas } from "./WorkflowGraphCanvas";
import type { WorkflowGraphDraft } from "@/lib/workflow-graph-types";
import type {
  WorkflowGraphReactEdge,
  WorkflowGraphReactNode,
} from "@/lib/workflow-graph-react-flow";

const h = vi.hoisted(() => ({
  isEditEnabled: vi.fn(() => true),
  sendJson: vi.fn(),
}));

vi.mock("@/lib/workflow-feature-client", () => ({
  isWorkflowGraphEditEnabled: () => h.isEditEnabled(),
}));
vi.mock("@/lib/client", () => ({
  sendJson: (...args: unknown[]) => h.sendJson(...args),
  ApiError: class ApiError extends Error {
    status = 500;
  },
}));

type ReactFlowProps = {
  nodes: WorkflowGraphReactNode[];
  edges: WorkflowGraphReactEdge[];
  onNodeClick?: (event: unknown, node: WorkflowGraphReactNode) => void;
  onEdgeClick?: (event: unknown, edge: WorkflowGraphReactEdge) => void;
  onPaneClick?: () => void;
  onMoveStart?: () => void;
  onMoveEnd?: (event: unknown, viewport: unknown) => void;
  children?: ReactNode;
};

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    nodes,
    edges,
    onNodeClick,
    onEdgeClick,
    onPaneClick,
    onMoveStart,
    onMoveEnd,
    children,
  }: ReactFlowProps) => (
    <div data-testid="reactflow">
      {nodes.map((node) => (
        <button
          key={node.id}
          data-testid={`node-${node.id}`}
          onClick={(event) => onNodeClick?.(event, node)}
        >
          {node.id}
        </button>
      ))}
      {edges.map((edge) => (
        <button
          key={edge.id}
          data-testid={`edge-${edge.id}`}
          onClick={(event) => onEdgeClick?.(event, edge)}
        >
          {edge.id}
        </button>
      ))}
      <button data-testid="pane" onClick={() => onPaneClick?.()}>
        pane
      </button>
      <button data-testid="move-start" onClick={() => onMoveStart?.()}>
        move-start
      </button>
      <button
        data-testid="move-end"
        onClick={() => onMoveEnd?.(undefined, { x: 1, y: 2, zoom: 1 })}
      >
        move-end
      </button>
      {children}
    </div>
  ),
  Background: () => null,
  BackgroundVariant: { Dots: "dots" },
  Controls: () => null,
  MiniMap: () => null,
  Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const graph: WorkflowGraphDraft = {
  id: "graph-1",
  workspaceId: "ws-1",
  schemaVersion: "workflow-graph-v1",
  graphRevision: 1,
  registryVersion: "1",
  nodes: [
    {
      id: "node-a",
      type: "start",
      typeVersion: 1,
      label: "Start",
      position: { x: 0, y: 0 },
      config: {},
      disabled: false,
    },
    {
      id: "node-b",
      type: "prompt",
      typeVersion: 1,
      label: "Prompt",
      position: { x: 100, y: 0 },
      config: {},
      disabled: false,
    },
  ],
  edges: [
    {
      id: "edge-1",
      source: "node-a",
      sourceHandle: "out",
      target: "node-b",
      targetHandle: "in",
      kind: "success",
    },
  ],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderCanvas(overrides: Partial<Parameters<typeof WorkflowGraphCanvas>[0]> = {}) {
  const onSelectNode = vi.fn();
  const onSelectEdge = vi.fn();
  const onRefresh = vi.fn(async () => undefined);
  render(
    <WorkflowGraphCanvas
      graph={graph}
      states={[]}
      selectedNodeId={null}
      onSelectNode={onSelectNode}
      selectedEdgeId={null}
      onSelectEdge={onSelectEdge}
      direction="TB"
      taskId="task-1"
      graphRevision={1}
      onRefresh={onRefresh}
      {...overrides}
    />,
  );
  return { onSelectNode, onSelectEdge, onRefresh };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.isEditEnabled.mockReturnValue(true);
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
});

describe("WorkflowGraphCanvas", () => {
  it("renders the node/edge counts in the legend", () => {
    renderCanvas();
    expect(screen.getByText("2 Nodes")).toBeTruthy();
    expect(screen.getByText("1 Edges")).toBeTruthy();
  });

  it("selects a node and clears the edge selection", () => {
    const { onSelectNode, onSelectEdge } = renderCanvas();
    fireEvent.click(screen.getByTestId("node-node-a"));
    expect(onSelectNode).toHaveBeenCalledWith("node-a");
    expect(onSelectEdge).toHaveBeenCalledWith(null);
  });

  it("selects an edge and clears the node selection", () => {
    const { onSelectNode, onSelectEdge } = renderCanvas();
    fireEvent.click(screen.getByTestId("edge-edge-1"));
    expect(onSelectNode).toHaveBeenCalledWith(null);
    expect(onSelectEdge).toHaveBeenCalledWith("edge-1");
  });

  it("clears both selections on pane click", () => {
    const { onSelectNode, onSelectEdge } = renderCanvas();
    fireEvent.click(screen.getByTestId("pane"));
    expect(onSelectNode).toHaveBeenCalledWith(null);
    expect(onSelectEdge).toHaveBeenCalledWith(null);
  });

  it("does not persist the viewport when editing is disabled", () => {
    renderCanvas({ editingEnabled: false });
    fireEvent.click(screen.getByTestId("move-start"));
    fireEvent.click(screen.getByTestId("move-end"));
    expect(h.sendJson).not.toHaveBeenCalled();
  });
});
