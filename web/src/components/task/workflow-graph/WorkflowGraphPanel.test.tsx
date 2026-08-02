import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkflowDefinitionSnapshot } from "@/lib/workflow-types";
import { synthesizeWorkflowGraph } from "@/lib/workflow-graph-compat";

let viewportWidth = 1280;
const mediaListeners = new Set<() => void>();

vi.mock("next/dynamic", () => ({
  default: () => (props: { graph: { nodes: unknown[] } }) => (
    <div data-testid="mock-workflow-canvas">{props.graph.nodes.length} nodes</div>
  ),
}));

import { WorkflowGraphPanel } from "./WorkflowGraphPanel";

function matchMedia(query: string): MediaQueryList {
  const matches = query.includes("767px")
    ? viewportWidth <= 767
    : viewportWidth <= 1279;
  return {
    matches,
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      mediaListeners.add(listener as () => void);
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      mediaListeners.delete(listener as () => void);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  } as MediaQueryList;
}

const graph = synthesizeWorkflowGraph(createWorkflowDefinitionSnapshot(), {
  id: "graph-responsive",
  workspaceId: "ws-responsive",
});
const workflow = {
  workspaceId: "ws-responsive",
  executionMode: "workflow",
  workspaceRevision: 1,
  primarySessionId: "ses-1",
  run: { id: "run-1", revision: 1, status: "running", primaryNodeKey: "implement_ui", pauseReason: "" },
  nodes: [],
} as never;

describe("WorkflowGraphPanel responsive modes", () => {
  afterEach(() => {
    cleanup();
    mediaListeners.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    [390, "mobile", "TB"],
    [768, "tablet", "LR"],
    [1280, "desktop", "LR"],
  ] as const)("uses the expected layout at %spx", (width, mode, direction) => {
    viewportWidth = width;
    vi.stubGlobal("matchMedia", matchMedia);
    render(
      <WorkflowGraphPanel
        graph={graph}
        workflow={workflow}
        taskId="ws-responsive"
        onOpenChat={vi.fn()}
        onOpenDiff={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const panel = screen.getByRole("region", { name: "Workflow Graph進捗" });
    expect(panel.getAttribute("data-graph-viewport")).toBe(mode);
    expect(panel.getAttribute("data-graph-direction")).toBe(direction);
  });
});
