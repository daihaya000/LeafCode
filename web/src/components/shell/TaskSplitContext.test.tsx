import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSplitProvider, useTaskSplit } from "./TaskSplitContext";

const h = vi.hoisted(() => ({
  pathname: { current: "/" },
  routerPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname.current,
  useRouter: () => ({ push: h.routerPush }),
}));

function SplitProbe() {
  const value = useTaskSplit();
  return (
    <div
      data-testid="probe"
      data-primary={value.primaryTaskId ?? ""}
      data-secondary={value.secondaryTaskId ?? ""}
      data-active={value.activeTaskId ?? ""}
      data-split-active={String(value.splitActive)}
      data-desktop={String(value.desktopSplitEnabled)}
      data-host={String(value.splitHostEnabled)}
    >
      <button onClick={() => value.openSplit("task-b")}>open-b</button>
      <button onClick={() => value.openSplitLeft("task-c")}>open-left-c</button>
      <button onClick={() => value.closeSplit()}>close</button>
      <button onClick={() => value.activateTask("task-a")}>activate-a</button>
      <button onClick={() => value.activatePrimary()}>activate-primary</button>
    </div>
  );
}

function renderProbe() {
  render(
    <TaskSplitProvider>
      <SplitProbe />
    </TaskSplitProvider>,
  );
  return screen.getByTestId("probe");
}

const desktopMedia = () => ({
  matches: true,
  media: "(min-width: 1024px)",
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  h.pathname.current = "/";
});

afterEach(() => {
  cleanup();
});

describe("TaskSplitProvider", () => {
  it("parses the primary task id from /task/:id", () => {
    h.pathname.current = "/task/task-a";
    const probe = renderProbe();
    expect(probe.dataset.primary).toBe("task-a");
    expect(probe.dataset.host).toBe("true");
  });

  it("is not a split host on other paths", () => {
    h.pathname.current = "/settings";
    const probe = renderProbe();
    expect(probe.dataset.host).toBe("false");
  });

  it("decodes percent-encoded task ids", () => {
    h.pathname.current = "/task/%E3%83%86%E3%82%B9%E3%83%88";
    const probe = renderProbe();
    expect(probe.dataset.primary).toBe("テスト");
  });

  it("keeps the split inactive on a non-desktop viewport", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    try {
      h.pathname.current = "/task/task-a";
      const probe = renderProbe();
      expect(probe.dataset.desktop).toBe("false");
      expect(probe.dataset.splitActive).toBe("false");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens a secondary split on desktop and closes it again", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => desktopMedia()));
    try {
      h.pathname.current = "/task/task-a";
      const probe = renderProbe();
      fireEvent.click(screen.getByText("open-b"));
      await waitFor(() => expect(probe.dataset.secondary).toBe("task-b"));
      expect(probe.dataset.active).toBe("task-b");
      expect(probe.dataset.splitActive).toBe("true");

      fireEvent.click(screen.getByText("close"));
      await waitFor(() => expect(probe.dataset.secondary).toBe(""));
      expect(probe.dataset.active).toBe("task-a");
      expect(probe.dataset.splitActive).toBe("false");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("routes to the task when opening in the left pane", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => desktopMedia()));
    try {
      h.pathname.current = "/task/task-a";
      const probe = renderProbe();
      fireEvent.click(screen.getByText("open-left-c"));
      await waitFor(() => expect(probe.dataset.active).toBe("task-c"));
      expect(h.routerPush).toHaveBeenCalledWith("/task/task-c");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ignores opening the primary or an existing secondary", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => desktopMedia()));
    try {
      h.pathname.current = "/task/task-a";
      const probe = renderProbe();
      fireEvent.click(screen.getByText("activate-a"));
      fireEvent.click(screen.getByText("open-b"));
      await waitFor(() => expect(probe.dataset.secondary).toBe("task-b"));
      fireEvent.click(screen.getByText("open-b")); // same id → no change
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(probe.dataset.secondary).toBe("task-b");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
