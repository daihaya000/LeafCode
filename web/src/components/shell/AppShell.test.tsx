import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppShell } from "./AppShell";

const { usePathname, routerPush } = vi.hoisted(() => ({
  usePathname: vi.fn(() => "/"),
  routerPush: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  apiUrl: (path: string) => `http://localhost${path}`,
  ocJson: vi.fn(),
  getJson: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname,
  useRouter: () => ({ push: routerPush, replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));

vi.mock("@/components/addons/AddonHost", () => ({
  AddonHost: () => <div data-testid="addon-host" />,
}));

vi.mock("./Sidebar", () => ({
  Sidebar: ({ mobileOpen }: { mobileOpen: boolean }) => (
    <aside data-testid="sidebar" data-mobile-open={mobileOpen}>
      <button
        type="button"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("application/x-opencode-task", "right-task");
        }}
      >
        右タスクをドラッグ
      </button>
      <button
        type="button"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(
            "application/x-opencode-task",
            "replacement-task",
          );
        }}
      >
        差し替えタスクをドラッグ
      </button>
    </aside>
  ),
}));

vi.mock("@/components/task/TaskView", () => ({
  TaskView: ({
    taskId,
    onCloseSplit,
  }: {
    taskId: string;
    onCloseSplit?: () => void;
  }) => (
    <div data-testid={`task-view-${taskId}`}>
      {taskId}
      {onCloseSplit && (
        <button type="button" onClick={onCloseSplit}>
          分割表示を閉じる
        </button>
      )}
    </div>
  ),
}));

vi.mock("./GlobalAttentionProvider", () => ({
  GlobalAttentionProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useOptionalGlobalAttention: () => null,
}));

vi.mock("./AttentionQueueModal", () => ({
  AttentionQueueModal: () => null,
}));

vi.mock("@/components/CommandPalette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));

function stubDesktopViewport(matches = true) {
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches,
    media: "(min-width: 1024px)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

function createDataTransfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: "none",
    dropEffect: "none",
    types: [] as string[],
    setData(type: string, value: string) {
      values.set(type, value);
      if (!this.types.includes(type)) this.types.push(type);
    },
    getData(type: string) {
      return values.get(type) ?? "";
    },
  };
}

describe("AppShell", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/");
    routerPush.mockReset();
    vi.stubGlobal("EventSource", class {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readyState = 1;
      close = vi.fn(() => {
        this.readyState = 2;
      });
      private listeners = new Map<string, Array<() => void>>();

      addEventListener(type: string, listener: () => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
      }

      removeEventListener(type: string, listener: () => void) {
        const list = this.listeners.get(type);
        if (!list) return;
        this.listeners.set(
          type,
          list.filter((l) => l !== listener),
        );
      }
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders children", () => {
    const { getByText } = render(
      <AppShell>
        <div>child</div>
      </AppShell>,
    );
    expect(getByText("child")).toBeTruthy();
  });

  it("does not render AddonHost outside the sidebar", () => {
    const { container } = render(
      <AppShell>
        <div>child</div>
      </AppShell>,
    );

    expect(container.querySelector('[data-testid="addon-host"]')).toBeNull();
  });

  it("no longer renders the legacy mobile brand bar", () => {
    const { queryByText, queryByLabelText } = render(
      <AppShell>
        <div>child</div>
      </AppShell>,
    );

    // The old top bar had a "LeafCode" brand link and its own メニュー
    // button; those moved into per-page headers, so AppShell must not render
    // them anymore.
    expect(queryByText("LeafCode")).toBeNull();
    expect(queryByLabelText("メニュー")).toBeNull();
  });

  it("starts with the mobile drawer closed", () => {
    const { getByTestId } = render(
      <AppShell>
        <div>child</div>
      </AppShell>,
    );

    expect(getByTestId("sidebar").getAttribute("data-mobile-open")).toBe(
      "false",
    );
  });

  it("opens a desktop-only right task pane by drag and drop", async () => {
    usePathname.mockReturnValue("/task/left-task");
    stubDesktopViewport();
    const dataTransfer = createDataTransfer();

    render(
      <AppShell>
        <div>left task</div>
      </AppShell>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "右タスクをドラッグ" })).toBeTruthy(),
    );

    fireEvent.dragStart(
      screen.getByRole("button", { name: "右タスクをドラッグ" }),
      { dataTransfer },
    );
    expect(await screen.findByTestId("task-split-drop-zone-left")).toBeTruthy();
    const dropZone = screen.getByTestId("task-split-drop-zone-right");
    fireEvent.dragOver(dropZone, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("copy");
    fireEvent.drop(dropZone, { dataTransfer });

    expect(await screen.findByTestId("task-view-right-task")).toBeTruthy();
    expect(screen.getByRole("region", { name: "左ペイン" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "右ペイン" })).toBeTruthy();

    const dragButton = screen.getByRole("button", { name: "右タスクをドラッグ" });
    fireEvent.dragStart(dragButton, { dataTransfer });
    expect(screen.queryByTestId("task-split-drop-zone-left")).toBeNull();
    expect(screen.queryByTestId("task-split-drop-zone-right")).toBeNull();
    fireEvent.dragEnd(dragButton, { dataTransfer });

    fireEvent.click(screen.getByRole("button", { name: "分割表示を閉じる" }));
    await waitFor(() =>
      expect(screen.queryByTestId("task-view-right-task")).toBeNull(),
    );
    expect(screen.getByRole("region", { name: "メインコンテンツ" })).toBeTruthy();
  });

  it("replaces only the left pane and preserves the right pane", async () => {
    usePathname.mockReturnValue("/task/left-task");
    stubDesktopViewport();
    const view = render(
      <AppShell>
        <div>left task</div>
      </AppShell>,
    );

    const rightDataTransfer = createDataTransfer();
    fireEvent.dragStart(
      screen.getByRole("button", { name: "右タスクをドラッグ" }),
      { dataTransfer: rightDataTransfer },
    );
    const rightDropZone = await screen.findByTestId("task-split-drop-zone-right");
    fireEvent.drop(rightDropZone, { dataTransfer: rightDataTransfer });
    expect(await screen.findByTestId("task-view-right-task")).toBeTruthy();

    const replacementDataTransfer = createDataTransfer();
    fireEvent.dragStart(
      screen.getByRole("button", { name: "差し替えタスクをドラッグ" }),
      { dataTransfer: replacementDataTransfer },
    );
    const leftDropZone = await screen.findByTestId("task-split-drop-zone-left");
    fireEvent.dragOver(leftDropZone, { dataTransfer: replacementDataTransfer });
    expect(replacementDataTransfer.dropEffect).toBe("copy");
    fireEvent.drop(leftDropZone, { dataTransfer: replacementDataTransfer });

    expect(routerPush).toHaveBeenCalledWith("/task/replacement-task");
    expect(screen.getByTestId("task-view-right-task")).toBeTruthy();
    usePathname.mockReturnValue("/task/replacement-task");
    view.rerender(
      <AppShell>
        <div>replacement task</div>
      </AppShell>,
    );

    const rightPane = await screen.findByRole("region", {
      name: "右ペイン",
    });
    expect(rightPane.querySelector('[data-testid="task-view-right-task"]')).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "左ペイン" }).textContent,
    ).toContain("replacement task");
  });

  it("keeps HomeView on the left when a task is dropped on the right", async () => {
    usePathname.mockReturnValue("/");
    stubDesktopViewport();
    const dataTransfer = createDataTransfer();

    render(
      <AppShell>
        <div>home view</div>
      </AppShell>,
    );
    fireEvent.dragStart(
      screen.getByRole("button", { name: "右タスクをドラッグ" }),
      { dataTransfer },
    );
    const rightDropZone = await screen.findByTestId("task-split-drop-zone-right");
    fireEvent.drop(rightDropZone, { dataTransfer });

    expect(screen.getByRole("region", { name: "左ペイン" }).textContent).toContain(
      "home view",
    );
    expect(await screen.findByTestId("task-view-right-task")).toBeTruthy();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("does not offer split drop on a non-desktop viewport", async () => {
    usePathname.mockReturnValue("/task/left-task");
    stubDesktopViewport(false);
    const dataTransfer = createDataTransfer();

    render(<AppShell><div>left task</div></AppShell>);
    fireEvent.dragStart(
      screen.getByRole("button", { name: "右タスクをドラッグ" }),
      { dataTransfer },
    );

    expect(screen.queryByTestId("task-split-drop-zone-left")).toBeNull();
    expect(screen.queryByTestId("task-split-drop-zone-right")).toBeNull();
  });
});
