import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { NextAction } from "./NextAction";

const { sendJsonMock } = vi.hoisted(() => ({
  sendJsonMock: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  sendJson: sendJsonMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("NextAction", () => {
  it("renders the generate button in idle state", () => {
    render(
      <NextAction
        taskId="task-1"
        sessionId="ses-1"
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("次の指示を提案")).toBeTruthy();
  });

  it("shows loading state with aria-busy during generation", async () => {
    sendJsonMock.mockReturnValue(new Promise(() => {})); // never resolves
    render(
      <NextAction
        taskId="task-1"
        sessionId="ses-1"
        onApply={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("次の指示を提案"));
    await waitFor(() => {
      expect(screen.getByText("提案を作成中…")).toBeTruthy();
    });
    const container = screen.getByText("提案を作成中…").parentElement;
    expect(container?.getAttribute("aria-busy")).toBe("true");
  });

  it("shows success state with apply and regenerate buttons", async () => {
    sendJsonMock.mockResolvedValueOnce({ suggestion: "テストを実行してください" });
    render(
      <NextAction
        taskId="task-1"
        sessionId="ses-1"
        onApply={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("次の指示を提案"));
    await waitFor(() => {
      expect(screen.getByText("テストを実行してください")).toBeTruthy();
    });
    expect(screen.getByLabelText("入力欄に入れる")).toBeTruthy();
    expect(screen.getByLabelText("再生成")).toBeTruthy();
  });

  it("calls onApply with the suggestion when apply is clicked", async () => {
    const onApply = vi.fn();
    sendJsonMock.mockResolvedValueOnce({ suggestion: "テストを実行してください" });
    render(
      <NextAction
        taskId="task-1"
        sessionId="ses-1"
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByLabelText("次の指示を提案"));
    await waitFor(() => {
      expect(screen.getByText("テストを実行してください")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("入力欄に入れる"));
    expect(onApply).toHaveBeenCalledWith("テストを実行してください");
  });

  it("shows error state with retry button on failure", async () => {
    sendJsonMock.mockRejectedValueOnce(new Error("提案の生成に失敗しました。"));
    render(
      <NextAction
        taskId="task-1"
        sessionId="ses-1"
        onApply={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("次の指示を提案"));
    await waitFor(() => {
      expect(screen.getByText("提案の生成に失敗しました。")).toBeTruthy();
    });
    const alert = screen.getByRole("alert");
    expect(alert).toBeTruthy();
    expect(screen.getByLabelText("再試行")).toBeTruthy();
  });

  it("resets to idle when invalidateKey changes", async () => {
    sendJsonMock.mockResolvedValueOnce({ suggestion: "テスト" });
    const { rerender } = render(
      <NextAction
        taskId="task-1"
        sessionId="ses-1"
        onApply={vi.fn()}
        invalidateKey="v1"
      />,
    );
    fireEvent.click(screen.getByLabelText("次の指示を提案"));
    await waitFor(() => {
      expect(screen.getByText("テスト")).toBeTruthy();
    });
    // Change the invalidation key
    rerender(
      <NextAction
        taskId="task-1"
        sessionId="ses-1"
        onApply={vi.fn()}
        invalidateKey="v2"
      />,
    );
    // Should be back to idle state
    expect(screen.getByLabelText("次の指示を提案")).toBeTruthy();
  });

  it("sends model and agent in the request body", async () => {
    sendJsonMock.mockResolvedValueOnce({ suggestion: "テスト" });
    render(
      <NextAction
        taskId="task-1"
        sessionId="ses-1"
        model="anthropic::claude-3"
        agent="build"
        onApply={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("次の指示を提案"));
    await waitFor(() => {
      expect(sendJsonMock).toHaveBeenCalled();
    });
    const call = sendJsonMock.mock.calls[0];
    expect(call?.[0]).toBe("POST");
    expect(call?.[1]).toBe("/api/tasks/task-1/next-action");
    expect(call?.[2]).toEqual({
      sessionId: "ses-1",
      model: { providerID: "anthropic", modelID: "claude-3" },
      agent: "build",
    });
  });
});
