import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowGraphInspector } from "./WorkflowGraphInspector";

const { sendJson } = vi.hoisted(() => ({ sendJson: vi.fn() }));
const feature = vi.hoisted(() => ({ editEnabled: false }));
vi.mock("@/lib/client", () => ({ sendJson }));
vi.mock("@/lib/workflow-feature-client", () => ({ isWorkflowGraphEditEnabled: () => feature.editEnabled }));

const graphNode = {
  id: "implement_ui",
  type: "opencode.implement_ui",
  typeVersion: 1,
  label: "Implement UI",
  position: { x: 0, y: 0 },
  config: { instructions: "Build it" },
  disabled: false,
};

const workflow = {
  workspaceId: "ws1",
  executionMode: "workflow",
  workspaceRevision: 2,
  primarySessionId: "ses1",
  run: { id: "run1", revision: 7, status: "paused", primaryNodeKey: "implement_ui", pauseReason: "Review required" },
  nodes: [],
} as never;

const nodeRun = {
  nodeKey: "implement_ui",
  latestAttemptNo: 2,
  attempts: [{
    status: "failed",
    opencodeSessionId: "ses-node",
    input: { prompt: "Build it" },
    result: { findings: [{ severity: "major", message: "Fix this" }], artifacts: [{ id: "art-1" }] },
    usageSnapshot: { inputTokens: 100, outputTokens: 40 },
  }],
} as never;

describe("WorkflowGraphInspector", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    feature.editEnabled = false;
  });

  it("shows evidence sections, Attention, and Chat/Diff/Retry actions", async () => {
    sendJson.mockResolvedValue({ workflow: {} });
    const onOpenChat = vi.fn();
    const onOpenDiff = vi.fn();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkflowGraphInspector
        taskId="ws1"
        graphNode={graphNode}
        nodeRun={nodeRun}
        workflow={workflow}
        onOpenChat={onOpenChat}
        onOpenDiff={onOpenDiff}
        onRefresh={onRefresh}
        mode="desktop"
      />,
    );

    expect(screen.getByText("Prompt")).toBeTruthy();
    expect(screen.getByText("Finding / Result")).toBeTruthy();
    expect(screen.getByText("Artifact")).toBeTruthy();
    expect(screen.getByText("Usage")).toBeTruthy();
    expect(screen.getByText("Attentionが必要です")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Chatで回答を確認" }));
    fireEvent.click(screen.getByRole("button", { name: "Diffで確認" }));
    fireEvent.click(screen.getByRole("button", { name: "Chatを開く" }));
    expect(onOpenChat).toHaveBeenCalledWith("implement_ui");
    expect(onOpenDiff).toHaveBeenCalledWith("implement_ui");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(sendJson).toHaveBeenCalledWith(
      "POST",
      "/api/tasks/ws1/workflow/nodes/implement_ui/retry",
      { workflowRevision: 7 },
    ));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("disables Chat and Retry for a control Node", () => {
    render(
      <WorkflowGraphInspector
        taskId="ws1"
        graphNode={{ ...graphNode, id: "review_gate", type: "control.review_gate", label: "Review Gate" }}
        nodeRun={undefined}
        workflow={workflow}
        onOpenChat={vi.fn()}
        onOpenDiff={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        mode="desktop"
      />,
    );
    expect(screen.getAllByRole("button", { name: "Chatを開く" }).at(-1)).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Retry" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Control NodeはRetry対象外です。")).toBeTruthy();
  });

  it("switches between historical Attempts", () => {
    const historyNodeRun = {
      nodeKey: "implement_ui",
      latestAttemptNo: 2,
      attempts: [
        { id: "attempt-1", attemptNo: 1, status: "failed", input: { prompt: "Build older" }, result: null, usageSnapshot: null },
        { id: "attempt-2", attemptNo: 2, status: "running", input: { prompt: "Build latest" }, result: null, usageSnapshot: null },
      ],
    } as never;
    render(
      <WorkflowGraphInspector
        taskId="ws1"
        graphNode={graphNode}
        nodeRun={historyNodeRun}
        workflow={workflow}
        onOpenChat={vi.fn()}
        onOpenDiff={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        mode="desktop"
      />,
    );
    expect(screen.getByText(/Build latest/)).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "表示するAttempt" }), { target: { value: "1" } });
    expect(screen.getByText(/Build older/)).toBeTruthy();
  });

  it("saves edited label and config through the Graph CAS API", async () => {
    feature.editEnabled = true;
    sendJson.mockResolvedValue({ graph: {} });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkflowGraphInspector
        taskId="ws1"
        graphRevision={4}
        graphNode={graphNode}
        nodeRun={undefined}
        workflow={workflow}
        onOpenChat={vi.fn()}
        onOpenDiff={vi.fn()}
        onRefresh={onRefresh}
        mode="desktop"
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Node label" }), { target: { value: "Updated implementation" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Node config JSON" }), { target: { value: '{"instructions":"Updated"}' } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Nodeを無効化" }));
    expect(screen.getByText("Draft編集 · 次回実行から適用")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Node設定を保存" }));
    await waitFor(() => expect(sendJson).toHaveBeenCalledWith(
      "PATCH",
      "/api/tasks/ws1/workflow/graph",
      {
        expectedGraphRevision: 4,
        operations: [
          { op: "set_node_label", nodeId: "implement_ui", label: "Updated implementation" },
          { op: "update_node_config", nodeId: "implement_ui", config: { instructions: "Updated" } },
          { op: "set_node_disabled", nodeId: "implement_ui", disabled: true },
        ],
      },
    ));
    expect(onRefresh).toHaveBeenCalled();
    expect(await screen.findByText("Node設定を保存しました。")).toBeTruthy();
  });

  it("closes the Inspector with its button and Escape", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <WorkflowGraphInspector
        taskId="ws1"
        graphNode={graphNode}
        nodeRun={nodeRun}
        workflow={workflow}
        onOpenChat={vi.fn()}
        onOpenDiff={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onClose={onClose}
        mode="tablet"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Inspectorを閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <WorkflowGraphInspector
        taskId="ws1"
        graphNode={graphNode}
        nodeRun={nodeRun}
        workflow={workflow}
        onOpenChat={vi.fn()}
        onOpenDiff={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onClose={onClose}
        mode="tablet"
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["mobile", "bottom-sheet"],
    ["tablet", "drawer"],
    ["desktop", "fixed"],
  ] as const)("exposes the %s Inspector presentation mode", (mode, expected) => {
    render(
      <WorkflowGraphInspector
        taskId="ws1"
        graphNode={null}
        nodeRun={undefined}
        workflow={workflow}
        onOpenChat={vi.fn()}
        onOpenDiff={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        mode={mode}
      />,
    );
    expect(screen.getByRole("complementary", { name: "Node Inspector" }).getAttribute("data-inspector-mode")).toBe(expected);
  });
});
