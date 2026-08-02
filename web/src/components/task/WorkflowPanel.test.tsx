import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { WorkflowPanel } from "./WorkflowPanel";

const { getJson } = vi.hoisted(() => ({ getJson: vi.fn() }));
vi.mock("@/lib/client", () => ({ getJson }));

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

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
  set onerror(_value: (() => void) | null) {}
}

describe("WorkflowPanel", () => {
  beforeEach(() => {
    getJson.mockResolvedValue({ workflow });
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    cleanup();
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
});
