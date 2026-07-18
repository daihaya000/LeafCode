import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphPanel } from "./GraphPanel";
import type { GraphLogPayload } from "@/lib/types";

const { getJson } = vi.hoisted(() => ({ getJson: vi.fn() }));

vi.mock("@/lib/client", () => ({
  getJson,
}));

function payloadWith(commitCount: number): GraphLogPayload {
  return {
    commits: Array.from({ length: commitCount }, (_, i) => ({
      hash: `hash${i}`,
      shortHash: `h${i}`,
      parents: i + 1 < commitCount ? [`hash${i + 1}`] : [],
      subject: `commit ${i}`,
      author: "tester",
      date: "2026-07-18T00:00:00Z",
    })),
    refs: [],
    currentBranch: "main",
    hasMore: false,
  };
}

function setVisible(visible: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
}

describe("GraphPanel", () => {
  beforeEach(() => {
    setVisible(true);
    getJson.mockReset();
    getJson.mockResolvedValue(payloadWith(1));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("loads the log once on mount", async () => {
    render(<GraphPanel directory="/repo" />);

    await screen.findByText("commit 0");
    expect(getJson).toHaveBeenCalledTimes(1);
    expect(getJson).toHaveBeenCalledWith(
      "/api/git/log",
      expect.objectContaining({ directory: "/repo" }),
    );
  });

  it("refetches immediately when refreshKey changes, without touching the visible spinner state", async () => {
    const { rerender } = render(
      <GraphPanel directory="/repo" refreshKey={0} />,
    );
    await screen.findByText("commit 0");
    expect(getJson).toHaveBeenCalledTimes(1);

    getJson.mockResolvedValueOnce(payloadWith(2));
    await act(async () => {
      rerender(<GraphPanel directory="/repo" refreshKey={1} />);
    });

    await screen.findByText("commit 1");
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it("polls faster while the agent is working, and stops polling on unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = render(
      <GraphPanel directory="/repo" working refreshKey={0} />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(getJson).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(getJson.mock.calls.length).toBeGreaterThanOrEqual(2);

    const callsAtUnmount = getJson.mock.calls.length;
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(getJson).toHaveBeenCalledTimes(callsAtUnmount);
  });

  it("does not poll while the tab is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setVisible(false);
    render(<GraphPanel directory="/repo" working />);

    await act(async () => {
      await Promise.resolve();
    });
    const callsAfterMount = getJson.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(getJson).toHaveBeenCalledTimes(callsAfterMount);
  });
});
