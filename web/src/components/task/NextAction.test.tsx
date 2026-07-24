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
      count: 1,
      model: { providerID: "anthropic", modelID: "claude-3" },
      agent: "build",
    });
  });

  it("does not send previousSuggestions on initial generation", async () => {
    sendJsonMock.mockResolvedValueOnce({ suggestion: "テスト" });
    render(
      <NextAction taskId="task-1" sessionId="ses-1" onApply={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("次の指示を提案"));
    await waitFor(() => {
      expect(screen.getByText("テスト")).toBeTruthy();
    });
    const body = sendJsonMock.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(body).not.toHaveProperty("previousSuggestions");
  });

  it("sends the shown suggestion back when regenerating", async () => {
    sendJsonMock.mockResolvedValueOnce({ suggestion: "テストを実行してください" });
    sendJsonMock.mockResolvedValueOnce({ suggestion: "エラーを修正してください" });
    render(
      <NextAction taskId="task-1" sessionId="ses-1" onApply={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("次の指示を提案"));
    await waitFor(() => {
      expect(screen.getByText("テストを実行してください")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("再生成"));
    await waitFor(() => {
      expect(screen.getByText("エラーを修正してください")).toBeTruthy();
    });
    // First call: no previousSuggestions.
    expect(sendJsonMock.mock.calls[0]?.[2]).not.toHaveProperty(
      "previousSuggestions",
    );
    // Second call: includes the suggestion that was on screen.
    const second = sendJsonMock.mock.calls[1]?.[2] as Record<string, unknown>;
    expect(second.previousSuggestions).toEqual(["テストを実行してください"]);
  });

  it("accumulates shown suggestions across multiple regenerations", async () => {
    sendJsonMock.mockResolvedValueOnce({ suggestion: "提案A" });
    sendJsonMock.mockResolvedValueOnce({ suggestion: "提案B" });
    sendJsonMock.mockResolvedValueOnce({ suggestion: "提案C" });
    render(
      <NextAction taskId="task-1" sessionId="ses-1" onApply={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("次の指示を提案"));
    await waitFor(() => {
      expect(screen.getByText("提案A")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("再生成"));
    await waitFor(() => {
      expect(screen.getByText("提案B")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("再生成"));
    await waitFor(() => {
      expect(screen.getByText("提案C")).toBeTruthy();
    });
    const third = sendJsonMock.mock.calls[2]?.[2] as Record<string, unknown>;
    expect(third.previousSuggestions).toEqual(["提案A", "提案B"]);
  });

  it("shows the suggestion count select defaulting to 1 with options 1–3", () => {
    render(
      <NextAction taskId="task-1" sessionId="ses-1" onApply={vi.fn()} />,
    );
    const select = screen.getByLabelText(
      "提案の件数",
    ) as HTMLSelectElement;
    expect(select.value).toBe("1");
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(["1", "2", "3"]);
  });

  it("sends the selected count in the request body", async () => {
    sendJsonMock.mockResolvedValueOnce({
      suggestion: "A",
      suggestions: ["A", "B", "C"],
    });
    render(
      <NextAction taskId="task-1" sessionId="ses-1" onApply={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("提案の件数"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByLabelText("次の指示を提案"));
    await waitFor(() => {
      expect(sendJsonMock).toHaveBeenCalled();
    });
    const body = sendJsonMock.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(body.count).toBe(3);
  });

  it("displays multiple suggestions individually with per-suggestion apply buttons", async () => {
    const onApply = vi.fn();
    sendJsonMock.mockResolvedValueOnce({
      suggestion: "提案A",
      suggestions: ["提案A", "提案B", "提案C"],
    });
    render(
      <NextAction taskId="task-1" sessionId="ses-1" onApply={onApply} />,
    );
    fireEvent.click(screen.getByLabelText("次の指示を提案"));
    await waitFor(() => {
      expect(screen.getByText("提案A")).toBeTruthy();
    });
    expect(screen.getByText("提案B")).toBeTruthy();
    expect(screen.getByText("提案C")).toBeTruthy();
    // Each suggestion has its own apply button with a distinct label.
    expect(screen.getByLabelText("入力欄に入れる 1")).toBeTruthy();
    expect(screen.getByLabelText("入力欄に入れる 2")).toBeTruthy();
    expect(screen.getByLabelText("入力欄に入れる 3")).toBeTruthy();
    // A single shared regenerate button.
    expect(screen.getByLabelText("再生成")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("入力欄に入れる 2"));
    expect(onApply).toHaveBeenCalledWith("提案B");
  });

  it("prefers the suggestions array over the legacy suggestion field", async () => {
    sendJsonMock.mockResolvedValueOnce({
      suggestion: "legacy-only",
      suggestions: ["新提案A", "新提案B"],
    });
    render(
      <NextAction taskId="task-1" sessionId="ses-1" onApply={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("次の指示を提案"));
    await waitFor(() => {
      expect(screen.getByText("新提案A")).toBeTruthy();
    });
    expect(screen.getByText("新提案B")).toBeTruthy();
    expect(screen.queryByText("legacy-only")).toBeNull();
  });

  it("sends all displayed suggestions back when regenerating multiple", async () => {
    sendJsonMock.mockResolvedValueOnce({
      suggestion: "提案A",
      suggestions: ["提案A", "提案B"],
    });
    sendJsonMock.mockResolvedValueOnce({
      suggestion: "提案C",
      suggestions: ["提案C"],
    });
    render(
      <NextAction taskId="task-1" sessionId="ses-1" onApply={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("提案の件数"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByLabelText("次の指示を提案"));
    await waitFor(() => {
      expect(screen.getByText("提案B")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("再生成"));
    await waitFor(() => {
      expect(screen.getByText("提案C")).toBeTruthy();
    });
    // First call: count 2, no previousSuggestions.
    const first = sendJsonMock.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(first.count).toBe(2);
    expect(first).not.toHaveProperty("previousSuggestions");
    // Second call: every suggestion shown so far is excluded.
    const second = sendJsonMock.mock.calls[1]?.[2] as Record<string, unknown>;
    expect(second.previousSuggestions).toEqual(["提案A", "提案B"]);
  });

  it("shows the error state when the response contains no usable suggestion", async () => {
    sendJsonMock.mockResolvedValueOnce({});
    render(
      <NextAction taskId="task-1" sessionId="ses-1" onApply={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("次の指示を提案"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(screen.getByText("提案の生成に失敗しました。")).toBeTruthy();
  });

  it("drops previous suggestions after invalidateKey changes", async () => {
    sendJsonMock.mockResolvedValueOnce({ suggestion: "テスト" });
    sendJsonMock.mockResolvedValueOnce({ suggestion: "新しい提案" });
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
    // Conversation changed → component resets to idle and drops history.
    rerender(
      <NextAction
        taskId="task-1"
        sessionId="ses-1"
        onApply={vi.fn()}
        invalidateKey="v2"
      />,
    );
    fireEvent.click(screen.getByLabelText("次の指示を提案"));
    await waitFor(() => {
      expect(screen.getByText("新しい提案")).toBeTruthy();
    });
    const second = sendJsonMock.mock.calls[1]?.[2] as Record<string, unknown>;
    expect(second).not.toHaveProperty("previousSuggestions");
  });
});
