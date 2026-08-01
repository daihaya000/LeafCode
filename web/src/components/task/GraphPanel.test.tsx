import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
      authorEmail: "tester@opencode.local",
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

  it("shows the commit ID as a graph label", async () => {
    render(<GraphPanel directory="/repo" />);

    const commitLabel = await screen.findByTitle("hash0");
    expect(commitLabel.textContent).toBe("h0");
    expect(commitLabel.classList.contains("rounded-md")).toBe(true);
    expect(commitLabel.classList.contains("border")).toBe(true);
    expect(commitLabel.classList.contains("font-mono")).toBe(true);
  });

  it("keeps the refresh control large enough for touch input", async () => {
    render(<GraphPanel directory="/repo" />);

    const refresh = await screen.findByRole("button", { name: "グラフを更新" });
    expect(refresh.classList.contains("h-9")).toBe(true);
    expect(refresh.classList.contains("w-9")).toBe(true);
  });

  it("shows the commit date in the metadata line", async () => {
    render(<GraphPanel directory="/repo" />);

    const commitDate = await screen.findByTitle("2026-07-18T00:00:00Z");
    expect(commitDate.tagName).toBe("TIME");
    expect(commitDate.textContent).toMatch(/\d{2}\/\d{2} \d{2}:\d{2}/);
  });

  it("shows the commit author name and email explicitly", async () => {
    render(<GraphPanel directory="/repo" />);

    expect(
      (await screen.findByTitle("作者: tester <tester@opencode.local>"))
        .textContent,
    ).toBe("作者: tester <tester@opencode.local>");
  });

  it("exposes expandable commit rows to assistive technology", async () => {
    getJson.mockImplementation((url: string) =>
      url === "/api/git/show"
        ? Promise.resolve({ files: [] })
        : Promise.resolve(payloadWith(1)),
    );
    render(<GraphPanel directory="/repo" />);

    const row = await screen.findByRole("button", { name: /commit 0/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(row.getAttribute("aria-controls")).toBe("graph-files-hash0");

    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("graph-files-hash0")).toBeTruthy();
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

  it("drops a stale log response after the directory changes", async () => {
    let resolveOld: (value: GraphLogPayload) => void = () => undefined;
    const oldPending = new Promise<GraphLogPayload>((resolve) => {
      resolveOld = resolve;
    });
    getJson.mockImplementationOnce(() => oldPending);
    getJson.mockResolvedValueOnce(payloadWith(1));

    const { rerender } = render(<GraphPanel directory="/repo-a" />);
    await act(async () => {
      await Promise.resolve();
    });

    rerender(<GraphPanel directory="/repo-b" />);
    await screen.findByText("commit 0");

    await act(async () => {
      resolveOld({
        ...payloadWith(1),
        commits: [
          {
            hash: "stale",
            shortHash: "stale",
            parents: [],
            subject: "stale commit",
            author: "tester",
            authorEmail: "tester@opencode.local",
            date: "2026-07-18T00:00:00Z",
          },
        ],
      });
      await Promise.resolve();
    });

    expect(screen.queryByText("stale commit")).toBeNull();
    expect(screen.getByText("commit 0")).toBeTruthy();
  });

  it("ignores a late commit detail response after unmount", async () => {
    let resolveShow!: (value: unknown) => void;
    const showPending = new Promise((resolve) => {
      resolveShow = resolve;
    });
    getJson.mockImplementation((url: string) => {
      if (url === "/api/git/log") return Promise.resolve(payloadWith(1));
      return showPending;
    });

    const { unmount } = render(<GraphPanel directory="/repo" />);
    await screen.findByText("commit 0");
    fireEvent.click(screen.getByRole("button", { name: /commit 0/ }));
    unmount();

    await act(async () => {
      resolveShow({ files: [] });
      await Promise.resolve();
    });
  });

  it("does not request commit details twice while expansion is pending", async () => {
    let resolveShow!: (value: unknown) => void;
    const showPending = new Promise((resolve) => {
      resolveShow = resolve;
    });
    getJson.mockImplementation((url: string) => {
      if (url === "/api/git/log") return Promise.resolve(payloadWith(1));
      return showPending;
    });

    render(<GraphPanel directory="/repo" />);
    await screen.findByText("commit 0");
    const row = screen.getByRole("button", { name: /commit 0/ });

    fireEvent.click(row);
    fireEvent.click(row);

    expect(
      getJson.mock.calls.filter(([url]) => url === "/api/git/show"),
    ).toHaveLength(1);
    expect(row.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      resolveShow({ files: [] });
      await Promise.resolve();
    });
  });
});
