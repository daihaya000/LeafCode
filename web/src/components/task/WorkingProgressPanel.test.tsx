import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MessageWithParts, Part } from "@/lib/types";
import { WorkingProgressPanel } from "./WorkingProgressPanel";

const FIXED_NOW = new Date("2026-01-01T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function message(parts: Part[]): MessageWithParts {
  return { info: { id: "m1", role: "assistant" }, parts };
}

function toolPart(overrides: Partial<Part> = {}): Part {
  return {
    id: "p1",
    messageID: "m1",
    type: "tool",
    tool: "bash",
    ...overrides,
  };
}

describe("WorkingProgressPanel", () => {
  it("shows 作業中… with the elapsed time while collapsed", () => {
    render(
      <WorkingProgressPanel
        status={null}
        messages={[]}
        todos={[]}
        mutationElapsedMs={12_000}
      />,
    );

    expect(screen.getByText("作業中…")).not.toBeNull();
    expect(screen.getByText("(12s)")).not.toBeNull();
    expect(screen.queryByText("実行中ツール")).toBeNull();
    expect(screen.queryByText("完了ステップ")).toBeNull();
  });

  it("prefers currentTool while collapsed", () => {
    render(
      <WorkingProgressPanel
        status={null}
        messages={[]}
        todos={[]}
        mutationElapsedMs={null}
        currentTool="npm test"
      />,
    );

    expect(screen.getByText("npm test…")).not.toBeNull();
  });

  it("shows a retry headline with the retry message while collapsed", () => {
    render(
      <WorkingProgressPanel
        status={{ type: "retry", message: "モデル応答が途切れました" }}
        messages={[]}
        todos={[]}
        mutationElapsedMs={null}
      />,
    );

    expect(
      screen.getByText("リトライ中… モデル応答が途切れました"),
    ).not.toBeNull();
  });

  it("expands into running tools, done steps with durations, and todo progress", () => {
    const startedAt = FIXED_NOW.getTime();
    render(
      <WorkingProgressPanel
        status={null}
        messages={[
          message([
            toolPart({
              id: "done-1",
              tool: "edit",
              state: {
                status: "completed",
                title: "src/a.ts",
                time: { start: startedAt - 5_000, end: startedAt - 3_000 },
              },
            }),
            toolPart({
              id: "run-1",
              state: {
                status: "running",
                title: "npm test",
                time: { start: startedAt - 2_000 },
              },
            }),
            toolPart({
              id: "run-2",
              tool: "glob",
              state: {
                status: "pending",
                title: "**/*.ts",
                time: { start: startedAt - 1_000 },
              },
            }),
          ]),
        ]}
        todos={[
          { id: "t1", content: "実装する", status: "completed" },
          { id: "t2", content: "テストを書く", status: "in_progress" },
          { id: "t3", content: "コミットする", status: "pending" },
        ]}
        mutationElapsedMs={30_000}
      />,
    );

    expect(screen.queryByText("実行中ツール")).toBeNull();
    fireEvent.click(screen.getByRole("button"));

    // Kind badge + count + elapsed.
    expect(screen.getByTestId("working-kind-badge").textContent).toBe("ツール実行中");
    expect(screen.getByText("実行中 2 件")).not.toBeNull();

    // Running tools section.
    expect(screen.getByText("実行中ツール")).not.toBeNull();
    expect(screen.getByText("npm test")).not.toBeNull();
    expect(screen.getByText("**/*.ts")).not.toBeNull();

    // Done steps with duration.
    expect(screen.getByText("完了ステップ（1）")).not.toBeNull();
    expect(screen.getByText("src/a.ts")).not.toBeNull();
    expect(screen.getAllByText("2s").length).toBeGreaterThanOrEqual(1);

    // Todo progress.
    expect(screen.getByText("ToDo 1/3")).not.toBeNull();
    expect(screen.getByText("実装する")).not.toBeNull();
    expect(screen.getByText("テストを書く")).not.toBeNull();
    expect(screen.getByText("コミットする")).not.toBeNull();
  });

  it("includes the previous assistant message when the last one is pure text", () => {
    const startedAt = FIXED_NOW.getTime();
    render(
      <WorkingProgressPanel
        status={null}
        messages={[
          message([
            toolPart({
              id: "done-1",
              state: {
                status: "completed",
                title: "npm test",
                time: { start: startedAt - 10_000, end: startedAt - 8_000 },
              },
            }),
          ]),
          message([
            { id: "t1", messageID: "m2", type: "text", text: "実装が完了しました" },
          ]),
        ]}
        todos={[]}
        mutationElapsedMs={null}
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("完了ステップ（1）")).not.toBeNull();
    expect(screen.getByText("npm test")).not.toBeNull();
    expect(screen.getByText("2s")).not.toBeNull();
  });

  it("labels reasoning as 推論中 while the last part is reasoning with no text yet", () => {
    render(
      <WorkingProgressPanel
        status={null}
        messages={[
          message([
            { id: "r1", messageID: "m1", type: "reasoning", text: "考え中…" },
          ]),
        ]}
        todos={[]}
        mutationElapsedMs={null}
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("推論中…")).not.toBeNull();
    expect(screen.getByTestId("working-kind-badge").textContent).toBe("推論中");
  });

  it("labels a finished reasoning part (followed by text) as waiting", () => {
    render(
      <WorkingProgressPanel
        status={null}
        messages={[
          message([
            { id: "r1", messageID: "m1", type: "reasoning", text: "考えた" },
            { id: "t1", messageID: "m1", type: "text", text: "回答です" },
          ]),
        ]}
        todos={[]}
        mutationElapsedMs={null}
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("モデル応答待ち…")).not.toBeNull();
    expect(screen.getByTestId("working-kind-badge").textContent).toBe("モデル応答待ち");
  });

  it("collapses back to the summary row", () => {
    render(
      <WorkingProgressPanel
        status={null}
        messages={[
          message([
            toolPart({
              id: "run-1",
              state: { status: "running", title: "npm test", time: { start: FIXED_NOW.getTime() } },
            }),
          ]),
        ]}
        todos={[]}
        mutationElapsedMs={null}
      />,
    );

    const toggle = screen.getByRole("button");
    fireEvent.click(toggle);
    expect(screen.getByText("実行中ツール")).not.toBeNull();

    fireEvent.click(toggle);
    expect(screen.queryByText("実行中ツール")).toBeNull();
    expect(screen.getByText("作業中…")).not.toBeNull();
  });
});
