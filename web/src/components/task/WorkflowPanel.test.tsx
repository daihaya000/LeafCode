import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { WorkflowPanel } from "./WorkflowPanel";

const { getJson } = vi.hoisted(() => ({ getJson: vi.fn() }));
const graphFeature = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/lib/client", () => ({ getJson }));
vi.mock("@/lib/workflow-feature", () => ({
  isWorkflowGraphEnabled: () => graphFeature.enabled,
  isWorkflowGraphEditEnabled: () => false,
}));
vi.mock("./workflow-graph/WorkflowGraphCanvas", () => ({
  WorkflowGraphCanvas: ({ graph }: { graph: { nodes: unknown[] } }) => (
    <div data-testid="workflow-graph-canvas">{graph.nodes.length} nodes</div>
  ),
}));

const workflow = {
  workspaceId: "ws1",
  executionMode: "workflow",
  workspaceRevision: 2,
  primarySessionId: "ses1",
  run: { status: "running", revision: 4, pauseReason: "", cycleCount: 0, maxCycles: 3 },
  nodes: [
    { nodeKey: "implement_ui", latestAttemptNo: 1, attempts: [{ status: "succeeded", dispatchStatus: "result_received" }] },
    { nodeKey: "code_review", latestAttemptNo: 1, attempts: [{ status: "running", dispatchStatus: "awaiting_result" }] },
    { nodeKey: "visual_judge", latestAttemptNo: 0, attempts: [] },
  ],
} as never;

const graphWorkflow = {
  workspaceId: "ws1",
  executionMode: "workflow",
  workspaceRevision: 2,
  primarySessionId: "ses1",
  run: {
    id: "run-1",
    workspaceId: "ws1",
    templateKey: "ui_implementation_review",
    definitionSnapshot: {
      templateKey: "ui_implementation_review",
      outputMode: "fenced_json",
      nodes: [
        {
          key: "implement_ui",
          kind: "implement",
          label: "Implement UI",
          config: {
            agentName: "build",
            instructions: "Implement UI",
            contextFiles: [],
            model: { mode: "auto", optimizeFor: "quality" },
            permissions: { write: true, subagent: true, browser: true },
            gate: { blockingSeverities: ["critical", "major"], optional: false },
          },
        },
        {
          key: "code_review",
          kind: "review",
          label: "Code Review",
          config: {
            agentName: "code-reviewer",
            instructions: "Review",
            contextFiles: [],
            model: { mode: "auto", optimizeFor: "cost" },
            permissions: { write: false, subagent: false, browser: false },
            gate: { blockingSeverities: ["critical", "major"], optional: false },
          },
        },
        {
          key: "visual_judge",
          kind: "review",
          label: "Visual Judge",
          config: {
            agentName: "ui-ux-reviewer",
            instructions: "Judge",
            contextFiles: [],
            model: { mode: "auto", optimizeFor: "quality" },
            permissions: { write: false, subagent: false, browser: true },
            gate: { blockingSeverities: ["critical", "major"], optional: false },
          },
        },
      ],
      edges: [
        { from: "implement_ui", to: "code_review", condition: "completed" },
        { from: "implement_ui", to: "visual_judge", condition: "completed" },
        { from: "code_review", to: "implement_ui", condition: "blocking_findings" },
        { from: "visual_judge", to: "implement_ui", condition: "blocking_findings" },
      ],
    },
    taskContextSnapshot: { goal: "goal", acceptance: [], constraints: [] },
    status: "running",
    cycleCount: 0,
    maxCycles: 3,
    primaryNodeKey: "implement_ui",
    revision: 4,
    pauseReason: "",
    error: "",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  },
  nodes: [
    { nodeKey: "implement_ui", latestAttemptNo: 1, attempts: [{ status: "succeeded", dispatchStatus: "result_received" }] },
    { nodeKey: "code_review", latestAttemptNo: 1, attempts: [{ status: "running", dispatchStatus: "awaiting_result" }] },
    { nodeKey: "visual_judge", latestAttemptNo: 0, attempts: [] },
  ],
} as never;

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
  set onerror(_value: (() => void) | null) {}
}

describe("WorkflowPanel", () => {
  beforeEach(() => {
    graphFeature.enabled = false;
    getJson.mockResolvedValue({ workflow });
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    cleanup();
    graphFeature.enabled = false;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows progress and node statuses", async () => {
    render(<WorkflowPanel taskId="ws1" />);
    expect(await screen.findByRole("heading", { name: "Workflow" })).toBeTruthy();
    expect(screen.getByText(/Node完了/)).toBeTruthy();
    expect(screen.getByText("Implement UI")).toBeTruthy();
    expect(screen.getByText("Code Review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Code Review/ }));
    expect(screen.getByText("Node詳細")).toBeTruthy();
    await waitFor(() => expect(getJson).toHaveBeenCalledWith("/api/tasks/ws1/workflow"));
  });

  it("uses the read-only Graph panel when the Graph feature flag is enabled", async () => {
    graphFeature.enabled = true;
    getJson.mockImplementation((url: string) =>
      url.endsWith("/graph")
        ? Promise.reject(new Error("draft unavailable"))
        : Promise.resolve({ workflow: graphWorkflow }),
    );

    render(<WorkflowPanel taskId="ws1" />);

    expect(await screen.findByRole("heading", { name: "Workflow Graph" })).toBeTruthy();
    expect((await screen.findByTestId("workflow-graph-canvas")).textContent).toContain("4 nodes");
    expect(screen.getByRole("complementary", { name: "Workflow Nodeと接続の一覧" })).toBeTruthy();
    expect(screen.getByText("接続一覧")).toBeTruthy();
    expect(screen.getByText("Review Gate")).toBeTruthy();
  });

  it("prefers the persisted Graph Draft when it is available", async () => {
    graphFeature.enabled = true;
    const persistedGraph = {
      id: "draft-1",
      workspaceId: "ws1",
      schemaVersion: "workflow-graph-v1",
      graphRevision: 8,
      registryVersion: "workflow-registry-v1",
      nodes: [],
      edges: [],
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    };
    getJson.mockImplementation((url: string) =>
      Promise.resolve(url.endsWith("/graph") ? { graph: persistedGraph } : { workflow: graphWorkflow }),
    );
    render(<WorkflowPanel taskId="ws1" />);
    expect(await screen.findByRole("heading", { name: "Workflow Graph" })).toBeTruthy();
    await waitFor(() => expect(getJson).toHaveBeenCalledWith("/api/tasks/ws1/workflow/graph"));
    expect(screen.getByText("0 nodes")).toBeTruthy();
  });
});
