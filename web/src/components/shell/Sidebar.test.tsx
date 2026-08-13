import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatHeaderDate, Sidebar } from "./Sidebar";

const { getJson, sendJson, timedFetch, attentionState, closeSplit } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
  timedFetch: vi.fn().mockResolvedValue({ ok: false }),
  closeSplit: vi.fn(),
  attentionState: {
    items: [] as Array<{
      kind: "question" | "permission";
      request: { sessionID: string };
    }>,
    actionableItems: [] as Array<{
      kind: "question" | "permission";
      request: { sessionID: string };
    }>,
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string } & React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn(() => "/") }));

vi.mock("next/navigation", () => ({
  usePathname,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));

vi.mock("@/lib/client", () => ({
  getJson,
  sendJson,
  timedFetch,
}));

vi.mock("@/components/AddProjectButton", () => ({
  AddProjectButton: ({ variant }: { variant?: "button" | "icon" }) =>
    variant === "icon" ? (
      <button type="button">プロジェクトを追加</button>
    ) : (
      <button type="button" data-testid="add-project-button">
        プロジェクトを追加
      </button>
    ),
}));

vi.mock("@/components/addons/AddonHost", () => ({
  AddonHost: () => <div data-testid="addon-host">Addon widget</div>,
}));

vi.mock("./AttentionBadge", () => ({
  AttentionBadge: () => null,
}));

vi.mock("./GlobalAttentionProvider", () => ({
  useGlobalAttention: () => attentionState,
}));

vi.mock("./TaskSplitContext", () => ({
  useTaskSplit: () => ({
    desktopSplitEnabled: true,
    secondaryTaskId: null,
    closeSplit,
  }),
}));

describe("Sidebar", () => {
  it("formats the header build commit date", () => {
    expect(formatHeaderDate("2026-07-18T00:00:00Z")).toMatch(
      /\d{2}\/\d{2} \d{2}:\d{2}/,
    );
    expect(formatHeaderDate("not-a-date")).toBe("");
  });

  beforeEach(() => {
    attentionState.items = [];
    attentionState.actionableItems = [];
    usePathname.mockReturnValue("/");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") return Promise.resolve({ projects: [] });
      if (path === "/api/projects/archived")
        return Promise.resolve({ projects: [] });
      if (path === "/api/tasks") return Promise.resolve({ tasks: [], engineOk: true });
      if (path === "/api/tasks/archived") return Promise.resolve({ tasks: [] });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear(); // keep persisted expanded-state out of later tests
  });

  it("renders addons directly below the labelled add-project button", async () => {
    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    const addProject = await screen.findByTestId("add-project-button");
    const addonHost = screen.getByTestId("addon-host");

    expect(
      addProject.compareDocumentPosition(addonHost) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("exposes the mobile drawer with id=mobile-nav when open", async () => {
    document.body.style.overflow = "auto";
    const view = render(<Sidebar mobileOpen onClose={vi.fn()} />);

    const drawer = document.getElementById("mobile-nav");
    expect(drawer).toBeTruthy();
    expect(drawer?.getAttribute("role")).toBe("dialog");
    expect(drawer?.getAttribute("aria-modal")).toBe("true");
    // WebKit (iOS Safari) does not reliably propagate height through
    // `inset-y-0` alone to inner `h-full` flex scrollers; the drawer needs an
    // explicit height (h-dvh) and overflow-hidden so its internal task list
    // stays scrollable after collapsing the CodexBar addon.
    expect(drawer?.className).toContain("h-dvh");
    expect(drawer?.className).toContain("overflow-hidden");
    expect(drawer?.className).toContain("top-0");
    expect(drawer?.className).not.toContain("inset-y-0");
    expect(document.body.style.overflow).toBe("hidden");

    view.rerender(<Sidebar mobileOpen={false} onClose={vi.fn()} />);
    await waitFor(() => expect(document.body.style.overflow).toBe("auto"));
  });

  it("adds a favorite button for each bound session", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [{ id: "prj1", name: "Repo", rootPath: "/repo", favorite: false, lastOpenedAt: null }],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [{
            id: "ws1", projectId: "prj1", projectName: "Repo", title: "Task title",
            directory: "/repo", isolation: "current_folder", status: "idle", sessionId: "sess1",
            favorite: false, branch: "main", additions: 0, deletions: 0, filesChanged: 0,
            createdAt: "2026-07-18T00:00:00Z", updatedAt: "2026-07-18T00:00:00Z",
          }],
          engineOk: true,
        });
      }
      if (path === "/api/tasks/archived") return Promise.resolve({ tasks: [] });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    sendJson.mockResolvedValue({});

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);
    await screen.findByText("Repo");
    fireEvent.click(screen.getByRole("button", { name: "Repoを展開" }));
    const favorite = await screen.findByRole("button", { name: "「Task title」をお気に入りに追加" });
    const taskButton = screen.getByText("Task title").closest("button");
    const actionGroup = screen.getByTestId("task-row-actions");
    // The title row is its own full-width button so the title never shares
    // width with the archive/favorite icons; branch/session info (and the
    // action icons) live in a second row below it instead.
    expect(taskButton?.textContent).not.toContain("main");
    const infoRow = taskButton?.nextElementSibling;
    expect(infoRow?.textContent).toContain("main");
    // Actions render as a normal flex child (not absolutely positioned) at
    // the end of the info row, next to the cost/provider icons.
    expect(actionGroup.className).not.toContain("absolute");
    expect(actionGroup.className).toContain("shrink-0");
    expect(actionGroup.parentElement).toBe(infoRow);
    expect(taskButton?.getAttribute("draggable")).toBe("true");
    const dataTransfer = { effectAllowed: "none", setData: vi.fn() };
    fireEvent.dragStart(taskButton!, { dataTransfer });
    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      "application/x-opencode-task",
      "ws1",
    );
    fireEvent.click(favorite);

    await waitFor(() => expect(sendJson).toHaveBeenCalledWith(
      "POST",
      "/api/workspaces/ws1/sessions",
      { opencodeSessionId: "sess1", favorite: true },
    ));
  });

  it("gives the mobile header icon links explicit accessible names", async () => {
    render(<Sidebar mobileOpen onClose={vi.fn()} />);

    const drawer = document.getElementById("mobile-nav");
    expect(drawer).toBeTruthy();
    expect(within(drawer!).getByRole("link", { name: "新規タスク" })).toBeTruthy();
    expect(within(drawer!).getByRole("link", { name: "設定" })).toBeTruthy();
  });

  it("does not render the mobile drawer when closed", async () => {
    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);
    expect(document.getElementById("mobile-nav")).toBeNull();
  });

  it("shows the session's cumulative cost at the end of the branch row", async () => {
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "prj1",
              name: "Repo",
              rootPath: "/repo",
              favorite: false,
              lastOpenedAt: null,
            },
          ],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [
            {
              id: "ws1",
              projectId: "prj1",
              projectName: "Repo",
              title: "Task title",
              directory: "/repo",
              isolation: "current_folder",
              status: "idle",
              sessionId: "sess1",
              branch: "main",
              additions: 0,
              deletions: 0,
              filesChanged: 0,
              cost: 0.1234,
              providerID: "openai",
              createdAt: "2026-07-18T00:00:00Z",
              updatedAt: "2026-07-18T00:00:00Z",
            },
          ],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    const cost = await screen.findByTitle("このセッションの累計コスト");
    expect(cost.textContent).toContain("¥18.5");
    const row = cost.parentElement;
    expect(row).toBeTruthy();
    const text = row!.textContent ?? "";
    const provider = screen.getByTestId("sidebar-provider-icon");
    const providerWrap = provider.closest("span")!;
    const time = providerWrap.previousElementSibling as HTMLElement | null;
    expect(time?.textContent).toMatch(/前$/);
    // Cost is after the provider icon (row ends with cost).
    expect(
      Array.from(row!.children).indexOf(providerWrap),
    ).toBeLessThan(Array.from(row!.children).indexOf(cost));
    // Time sits immediately to the left of the provider icon so the title row
    // keeps as much horizontal room as possible.
    expect(Array.from(row!.children).indexOf(time!)).toBeLessThan(
      Array.from(row!.children).indexOf(providerWrap),
    );
    expect(text.indexOf("main")).toBeLessThan(text.indexOf("¥18.5"));
    // Left-aligned cost column sized to the longest label keeps prices readable
    // while preserving the reserved column width across rows.
    expect(cost.className).toContain("text-left");
    expect((cost as HTMLElement).style.minWidth).toBe("5ch"); // "¥18.5"
  });

  it("refreshes a working task cost while the sidebar is visible", async () => {
    let calls = 0;
    let costCalls = 0;
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [{
            id: "prj1",
            name: "Repo",
            rootPath: "/repo",
            favorite: false,
            lastOpenedAt: null,
          }],
        });
      }
      if (path === "/api/tasks") {
        calls += 1;
        return Promise.resolve({
          tasks: [{
            id: "ws1",
            projectId: "prj1",
            projectName: "Repo",
            title: "Task title",
            directory: "/repo",
            isolation: "current_folder",
            status: "working",
            sessionId: "sess1",
            branch: "main",
            additions: 0,
            deletions: 0,
            filesChanged: 0,
            cost: calls === 1 ? 0.1 : 0.2,
            createdAt: "2026-07-18T00:00:00Z",
            updatedAt: "2026-07-18T00:00:00Z",
          }],
          engineOk: true,
        });
      }
      if (path === "/api/tasks/ws1/cost") {
        costCalls += 1;
        return Promise.resolve({ cost: costCalls === 1 ? 0.2 : 0.2 });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    vi.useFakeTimers();

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTitle("このセッションの累計コスト").textContent).toContain("¥15.0");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTitle("このセッションの累計コスト").textContent).toContain("¥30.0");
  });

  it("ignores an older overlapping sidebar cost response", async () => {
    let firstResolve!: (value: { cost: number }) => void;
    let secondResolve!: (value: { cost: number }) => void;
    const first = new Promise<{ cost: number }>((resolve) => {
      firstResolve = resolve;
    });
    const second = new Promise<{ cost: number }>((resolve) => {
      secondResolve = resolve;
    });
    let costCalls = 0;
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [{
            id: "prj1",
            name: "Repo",
            rootPath: "/repo",
            favorite: false,
            lastOpenedAt: null,
          }],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [{
            id: "ws1",
            projectId: "prj1",
            projectName: "Repo",
            title: "Task title",
            directory: "/repo",
            isolation: "current_folder",
            status: "working",
            sessionId: "sess1",
            branch: "main",
            additions: 0,
            deletions: 0,
            filesChanged: 0,
            cost: 0.1,
            createdAt: "2026-07-18T00:00:00Z",
            updatedAt: "2026-07-18T00:00:00Z",
          }],
          engineOk: true,
        });
      }
      if (path === "/api/tasks/archived") return Promise.resolve({ tasks: [] });
      if (path === "/api/tasks/ws1/cost") {
        costCalls += 1;
        return costCalls === 1 ? first : second;
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    vi.useFakeTimers();

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(costCalls).toBe(2);

    await act(async () => {
      secondResolve({ cost: 0.3 });
      await second;
    });
    expect(screen.getByTitle("このセッションの累計コスト").textContent).toContain("¥45.0");

    await act(async () => {
      firstResolve({ cost: 0.2 });
      await first;
    });
    expect(screen.getByTitle("このセッションの累計コスト").textContent).toContain("¥45.0");
  });

  it("does not overlap active-task and engine-health refreshes", async () => {
    let taskCalls = 0;
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [{
            id: "prj1",
            name: "Repo",
            rootPath: "/repo",
            favorite: false,
            lastOpenedAt: null,
          }],
        });
      }
      if (path === "/api/tasks/archived") return Promise.resolve({ tasks: [] });
      if (path === "/api/tasks") {
        taskCalls += 1;
        if (taskCalls === 1) {
          return Promise.resolve({
            tasks: [{
              id: "ws1",
              projectId: "prj1",
              projectName: "Repo",
              title: "Working task",
              directory: "/repo",
              isolation: "current_folder",
              status: "working",
              sessionId: "sess1",
              branch: "main",
              additions: 0,
              deletions: 0,
              filesChanged: 0,
              createdAt: "2026-07-18T00:00:00Z",
              updatedAt: "2026-07-18T00:00:00Z",
            }],
            engineOk: false,
          });
        }
        return new Promise(() => undefined);
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Repoを展開" }));
    await screen.findByText("Working task");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(taskCalls).toBe(2);
  });

  it("omits the cost badge when the task has no known cost", async () => {
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "prj1",
              name: "Repo",
              rootPath: "/repo",
              favorite: false,
              lastOpenedAt: null,
            },
          ],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [
            {
              id: "ws1",
              projectId: "prj1",
              projectName: "Repo",
              title: "Task title",
              directory: "/repo",
              isolation: "current_folder",
              status: "idle",
              sessionId: "sess1",
              branch: "main",
              additions: 0,
              deletions: 0,
              filesChanged: 0,
              createdAt: "2026-07-18T00:00:00Z",
              updatedAt: "2026-07-18T00:00:00Z",
            },
          ],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    await screen.findByText("Task title");
    expect(screen.queryByTitle("このセッションの累計コスト")).toBeNull();
    // No task in the group has a cost, so no cost column is reserved; only the
    // always-visible timestamp follows the branch label. The archive/favorite
    // action icons are the actual last child of the info row.
    const row = screen.getByText("main").parentElement!;
    const timestamp = row.children[row.children.length - 2];
    expect(timestamp.textContent).toMatch(/前$/);
    expect(row.children[row.children.length - 1].getAttribute("data-testid")).toBe(
      "task-row-actions",
    );
  });

  it("reserves the same cost column on rows without a cost so icons align", async () => {
    usePathname.mockReturnValue("/task/ws1");
    const base = {
      projectId: "prj1",
      projectName: "Repo",
      directory: "/repo",
      isolation: "current_folder",
      status: "idle",
      branch: "main",
      additions: 0,
      deletions: 0,
      filesChanged: 0,
      providerID: "openai",
      createdAt: "2026-07-18T00:00:00Z",
      updatedAt: "2026-07-18T00:00:00Z",
    };
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "prj1",
              name: "Repo",
              rootPath: "/repo",
              favorite: false,
              lastOpenedAt: null,
            },
          ],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [
            { ...base, id: "ws1", title: "Paid", sessionId: "sess1", cost: 0.1234 },
            { ...base, id: "ws2", title: "Free", sessionId: "sess2" },
          ],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    const cost = await screen.findByTitle("このセッションの累計コスト");
    const freeCard = screen.getByText("Free").closest("button")!.parentElement!;
    const spacer = freeCard.querySelector<HTMLElement>("span[aria-hidden]")!;
    expect(spacer).toBeTruthy();
    expect(spacer.textContent).toBe("");
    // Same reserved width on both rows => provider icons share one column.
    expect(spacer.style.minWidth).toBe((cost as HTMLElement).style.minWidth);
  });

  it("sizes the cost column from the longest cost across all projects", async () => {
    usePathname.mockReturnValue("/task/ws1");
    localStorage.setItem(
      "webui.sidebar.expanded",
      JSON.stringify(["prj1", "prj2"]),
    );
    const base = {
      directory: "/repo",
      isolation: "current_folder",
      status: "idle",
      branch: "main",
      additions: 0,
      deletions: 0,
      filesChanged: 0,
      providerID: "openai",
      createdAt: "2026-07-18T00:00:00Z",
      updatedAt: "2026-07-18T00:00:00Z",
    };
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "prj1",
              name: "Repo",
              rootPath: "/repo",
              favorite: false,
              lastOpenedAt: null,
            },
            {
              id: "prj2",
              name: "Other",
              rootPath: "/other",
              favorite: false,
              lastOpenedAt: null,
            },
          ],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [
            {
              ...base,
              id: "ws1",
              projectId: "prj1",
              projectName: "Repo",
              title: "Cheap",
              sessionId: "sess1",
              cost: 0.01, // ¥1.5 (4 chars)
            },
            {
              ...base,
              id: "ws2",
              projectId: "prj2",
              projectName: "Other",
              title: "Pricey",
              sessionId: "sess2",
              cost: 12.3456, // ¥1,852 (6 chars)
            },
          ],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    await screen.findByText("Pricey");
    const widths = screen
      .getAllByTitle("このセッションの累計コスト")
      .map((el) => (el as HTMLElement).style.minWidth);
    expect(widths).toHaveLength(2);
    // The longest label lives in another project, yet both rows reserve it.
    expect(widths[0]).toBe("6ch");
    expect(widths[1]).toBe("6ch");
  });

  it("shows a warning dot when the task session is waiting for a question answer", async () => {
    attentionState.items = [{
      kind: "question",
      request: { sessionID: "sess1" },
    }];
    attentionState.actionableItems = attentionState.items;
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "prj1",
              name: "Repo",
              rootPath: "/repo",
              favorite: false,
              lastOpenedAt: null,
            },
          ],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [
            {
              id: "ws1",
              projectId: "prj1",
              projectName: "Repo",
              title: "Task title",
              directory: "/repo",
              isolation: "current_folder",
              status: "working",
              sessionId: "sess1",
              branch: "main",
              additions: 0,
              deletions: 0,
              filesChanged: 0,
              createdAt: "2026-07-18T00:00:00Z",
              updatedAt: "2026-07-18T00:00:00Z",
            },
          ],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    const dot = await screen.findByLabelText("質問への回答待ち");
    expect(dot.className).toContain("animate-pulse");
    expect(dot.className).toContain("bg-warning");
    expect(dot.className).not.toContain("bg-working");
    expect(screen.queryByLabelText("エージェントが処理中")).toBeNull();
  });

  it("does not mark a permission request for the same session as waiting for a question", async () => {
    attentionState.items = [{
      kind: "permission",
      request: { sessionID: "sess1" },
    }];
    attentionState.actionableItems = attentionState.items;
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [{
            id: "prj1",
            name: "Repo",
            rootPath: "/repo",
            favorite: false,
            lastOpenedAt: null,
          }],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [{
            id: "ws1",
            projectId: "prj1",
            projectName: "Repo",
            title: "Task title",
            directory: "/repo",
            isolation: "current_folder",
            status: "working",
            sessionId: "sess1",
            branch: "main",
            additions: 0,
            deletions: 0,
            filesChanged: 0,
            createdAt: "2026-07-18T00:00:00Z",
            updatedAt: "2026-07-18T00:00:00Z",
          }],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    // Permission requests also trigger waitingForAttention, so the spinner is
    // replaced with a warning dot labeled "権限の承認待ち"
    const warningDot = await screen.findByLabelText("権限の承認待ち");
    expect(warningDot.getAttribute("class")).toContain("bg-warning");
    expect(screen.queryByLabelText("エージェントが処理中")).toBeNull();
    expect(screen.queryByLabelText("質問への回答待ち")).toBeNull();
  });

  it("returns to the working spinner after the pending question is removed", async () => {
    attentionState.items = [{
      kind: "question",
      request: { sessionID: "sess1" },
    }];
    attentionState.actionableItems = attentionState.items;
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [{
            id: "prj1",
            name: "Repo",
            rootPath: "/repo",
            favorite: false,
            lastOpenedAt: null,
          }],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [{
            id: "ws1",
            projectId: "prj1",
            projectName: "Repo",
            title: "Task title",
            directory: "/repo",
            isolation: "current_folder",
            status: "working",
            sessionId: "sess1",
            branch: "main",
            additions: 0,
            deletions: 0,
            filesChanged: 0,
            createdAt: "2026-07-18T00:00:00Z",
            updatedAt: "2026-07-18T00:00:00Z",
          }],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    const view = render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    expect(await screen.findByLabelText("質問への回答待ち")).toBeTruthy();
    attentionState.items = [];
    attentionState.actionableItems = [];
    view.rerender(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    const spinner = await screen.findByLabelText("エージェントが処理中");
    expect(spinner.getAttribute("class")).toContain("animate-spin");
    expect(screen.queryByLabelText("質問への回答待ち")).toBeNull();
  });

  it("does not mark a different session as waiting for a question answer", async () => {
    attentionState.items = [{
      kind: "question",
      request: { sessionID: "other" },
    }];
    attentionState.actionableItems = attentionState.items;
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "prj1",
              name: "Repo",
              rootPath: "/repo",
              favorite: false,
              lastOpenedAt: null,
            },
          ],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [
            {
              id: "ws1",
              projectId: "prj1",
              projectName: "Repo",
              title: "Task title",
              directory: "/repo",
              isolation: "current_folder",
              status: "working",
              sessionId: "sess1",
              branch: "main",
              additions: 0,
              deletions: 0,
              filesChanged: 0,
              createdAt: "2026-07-18T00:00:00Z",
              updatedAt: "2026-07-18T00:00:00Z",
            },
          ],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    await screen.findByText("Task title");
    expect(screen.queryByLabelText("質問への回答待ち")).toBeNull();
  });

  it("shows a spinning ring when the task is working without a pending question", async () => {
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "prj1",
              name: "Repo",
              rootPath: "/repo",
              favorite: false,
              lastOpenedAt: null,
            },
          ],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [
            {
              id: "ws1",
              projectId: "prj1",
              projectName: "Repo",
              title: "Task title",
              directory: "/repo",
              isolation: "current_folder",
              status: "working",
              sessionId: "sess1",
              branch: "main",
              additions: 0,
              deletions: 0,
              filesChanged: 0,
              createdAt: "2026-07-18T00:00:00Z",
              updatedAt: "2026-07-18T00:00:00Z",
            },
          ],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    const spinner = await screen.findByLabelText("エージェントが処理中");
    expect(spinner.getAttribute("class")).toContain("animate-spin");
    expect(spinner.getAttribute("class")).toContain("text-working");
    expect(screen.queryByLabelText("状態: working")).toBeNull();
  });

  it("does not show a spinner for a non-working session", async () => {
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "prj1",
              name: "Repo",
              rootPath: "/repo",
              favorite: false,
              lastOpenedAt: null,
            },
          ],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [
            {
              id: "ws1",
              projectId: "prj1",
              projectName: "Repo",
              title: "Task title",
              directory: "/repo",
              isolation: "current_folder",
              status: "ready",
              sessionId: "sess1",
              branch: "main",
              additions: 0,
              deletions: 0,
              filesChanged: 0,
              createdAt: "2026-07-18T00:00:00Z",
              updatedAt: "2026-07-18T00:00:00Z",
            },
          ],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    const dot = await screen.findByLabelText("状態: ready");
    expect(dot.className).toContain("bg-success");
    expect(screen.queryByLabelText("エージェントが処理中")).toBeNull();
  });

  it("shows a provider icon on the task row when the task has a providerID", async () => {
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "prj1",
              name: "Repo",
              rootPath: "/repo",
              favorite: false,
              lastOpenedAt: null,
            },
          ],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [
            {
              id: "ws1",
              projectId: "prj1",
              projectName: "Repo",
              title: "Task title",
              directory: "/repo",
              isolation: "current_folder",
              status: "idle",
              sessionId: "sess1",
              branch: "main",
              additions: 0,
              deletions: 0,
              filesChanged: 0,
              agent: "build",
              providerID: "anthropic",
              modelID: "claude-opus",
              createdAt: "2026-07-18T00:00:00Z",
              updatedAt: "2026-07-18T00:00:00Z",
            },
          ],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    await screen.findByText("Task title");
    // A bundled brand icon exists for "anthropic" (→ claude), so the <img> renders.
    expect(screen.getByTestId("sidebar-provider-icon")).toBeTruthy();
  });

  it("renders cost after the provider icon when both are present", async () => {
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "prj1",
              name: "Repo",
              rootPath: "/repo",
              favorite: false,
              lastOpenedAt: null,
            },
          ],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [
            {
              id: "ws1",
              projectId: "prj1",
              projectName: "Repo",
              title: "Task title",
              directory: "/repo",
              isolation: "current_folder",
              status: "idle",
              sessionId: "sess1",
              branch: "main",
              additions: 0,
              deletions: 0,
              filesChanged: 0,
              cost: 0.1,
              providerID: "anthropic",
              createdAt: "2026-07-18T00:00:00Z",
              updatedAt: "2026-07-18T00:00:00Z",
            },
          ],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    await screen.findByText("Task title");
    const icon = screen.getByTestId("sidebar-provider-icon");
    const cost = screen.getByTitle("このセッションの累計コスト");
    const row = icon.closest(".flex.min-w-0.items-center") ?? icon.parentElement;
    expect(row).toBeTruthy();
    const html = row!.innerHTML;
    expect(html.indexOf("sidebar-provider-icon")).toBeLessThan(
      html.indexOf("このセッションの累計コスト"),
    );
    expect(cost.textContent).toContain("¥15.0");
  });

  it("falls back to a generic icon when the providerID has no bundled brand icon", async () => {
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "prj1",
              name: "Repo",
              rootPath: "/repo",
              favorite: false,
              lastOpenedAt: null,
            },
          ],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [
            {
              id: "ws1",
              projectId: "prj1",
              projectName: "Repo",
              title: "Task title",
              directory: "/repo",
              isolation: "current_folder",
              status: "idle",
              sessionId: "sess1",
              branch: "main",
              additions: 0,
              deletions: 0,
              filesChanged: 0,
              providerID: "some-unknown-provider",
              createdAt: "2026-07-18T00:00:00Z",
              updatedAt: "2026-07-18T00:00:00Z",
            },
          ],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    await screen.findByText("Task title");
    expect(screen.getByTestId("provider-icon-fallback")).toBeTruthy();
  });

  it("omits the provider icon when the task has no providerID", async () => {
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "prj1",
              name: "Repo",
              rootPath: "/repo",
              favorite: false,
              lastOpenedAt: null,
            },
          ],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [
            {
              id: "ws1",
              projectId: "prj1",
              projectName: "Repo",
              title: "Task title",
              directory: "/repo",
              isolation: "current_folder",
              status: "idle",
              sessionId: "sess1",
              branch: "main",
              additions: 0,
              deletions: 0,
              filesChanged: 0,
              createdAt: "2026-07-18T00:00:00Z",
              updatedAt: "2026-07-18T00:00:00Z",
            },
          ],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    await screen.findByText("Task title");
    expect(screen.queryByTestId("sidebar-provider-icon")).toBeNull();
    expect(screen.queryByTestId("provider-icon-fallback")).toBeNull();
  });

  it("archives a task without confirmation dialog", async () => {
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [{
            id: "prj1",
            name: "Repo",
            rootPath: "/repo",
            favorite: false,
            lastOpenedAt: null,
          }],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [{
            id: "ws1",
            projectId: "prj1",
            projectName: "Repo",
            title: "Task title",
            directory: "/repo",
            isolation: "current_folder",
            status: "idle",
            sessionId: "sess1",
            branch: "main",
            additions: 0,
            deletions: 0,
            filesChanged: 0,
            createdAt: "2026-07-18T00:00:00Z",
            updatedAt: "2026-07-18T00:00:00Z",
          }],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    await screen.findByText("Task title");
    screen.getByLabelText("「Task title」をアーカイブ").click();

    await vi.waitFor(() => {
      expect(sendJson).toHaveBeenCalledWith("PATCH", "/api/tasks/ws1/archive");
    });
  });

  it("keeps task row action buttons compact on desktop and tappable on touch", async () => {
    usePathname.mockReturnValue("/task/ws1");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [{
            id: "prj1",
            name: "Repo",
            rootPath: "/repo",
            favorite: false,
            lastOpenedAt: null,
          }],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [{
            id: "ws1",
            projectId: "prj1",
            projectName: "Repo",
            title: "Task title",
            directory: "/repo",
            isolation: "current_folder",
            status: "idle",
            sessionId: "sess1",
            branch: "main",
            additions: 0,
            deletions: 0,
            filesChanged: 0,
            createdAt: "2026-07-18T00:00:00Z",
            updatedAt: "2026-07-18T00:00:00Z",
          }],
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);
    await screen.findByText("Task title");

    expect(screen.queryByLabelText("会話からタイトルを再生成")).toBeNull();

    const btn = screen.getByLabelText("「Task title」をアーカイブ");
    // 44px touch target on phones, 24px box on md+ so the action button does not
    // crowd out the task title inside a 240px sidebar.
    expect(btn.className).toContain("h-11");
    expect(btn.className).toContain("md:h-6");
    expect(btn.className).toContain("md:w-6");
    expect(btn.className).not.toContain("md:h-8");
  });

  it("scrolls a project's task list independently once it has 5 or more sessions", async () => {
    localStorage.clear();
    const base = {
      projectId: "prj1",
      projectName: "Repo",
      directory: "/repo",
      isolation: "current_folder" as const,
      status: "idle" as const,
      branch: "main",
      additions: 0,
      deletions: 0,
      filesChanged: 0,
      createdAt: "2026-07-18T00:00:00Z",
      updatedAt: "2026-07-18T00:00:00Z",
    };
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [{ id: "prj1", name: "Repo", rootPath: "/repo", favorite: false, lastOpenedAt: null }],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: Array.from({ length: 5 }, (_, i) => ({
            ...base,
            id: `ws${i}`,
            title: `Task ${i}`,
            sessionId: `sess${i}`,
          })),
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    const expandBtn = await screen.findByLabelText("Repoを展開");
    fireEvent.click(expandBtn);
    await screen.findByText("Task 0");

    const list = screen.getByTestId("project-tasks-prj1");
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toContain("max-h-72");
  });

  it("does not make a project's task list scrollable with fewer than 5 sessions", async () => {
    localStorage.clear();
    const base = {
      projectId: "prj1",
      projectName: "Repo",
      directory: "/repo",
      isolation: "current_folder" as const,
      status: "idle" as const,
      branch: "main",
      additions: 0,
      deletions: 0,
      filesChanged: 0,
      createdAt: "2026-07-18T00:00:00Z",
      updatedAt: "2026-07-18T00:00:00Z",
    };
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [{ id: "prj1", name: "Repo", rootPath: "/repo", favorite: false, lastOpenedAt: null }],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: Array.from({ length: 4 }, (_, i) => ({
            ...base,
            id: `ws${i}`,
            title: `Task ${i}`,
            sessionId: `sess${i}`,
          })),
          engineOk: true,
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    const expandBtn = await screen.findByLabelText("Repoを展開");
    fireEvent.click(expandBtn);
    await screen.findByText("Task 0");

    const list = screen.getByTestId("project-tasks-prj1");
    expect(list.className).not.toContain("overflow-y-auto");
  });
});

describe("Sidebar archived section", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows archived section with archived tasks", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [{
            id: "prj1",
            name: "Repo",
            rootPath: "/repo",
            favorite: false,
            lastOpenedAt: null,
          }],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({ tasks: [], engineOk: true });
      }
      if (path === "/api/tasks/archived") {
        return Promise.resolve({
          tasks: [{
            id: "ws-archived",
            projectId: "prj1",
            projectName: "Repo",
            title: "Archived task",
            directory: "/repo",
            isolation: "current_folder",
            status: "merged",
            sessionId: null,
            branch: "main",
            additions: 0,
            deletions: 0,
            filesChanged: 0,
            createdAt: "2026-07-18T00:00:00Z",
            updatedAt: "2026-07-18T01:00:00Z",
          }],
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    // アーカイブセクションは初期状態で折りたたまれているため、展開する
    await waitFor(() => {
      expect(getJson).toHaveBeenCalledWith("/api/tasks");
    });
    expect(
      getJson.mock.calls.some(([path]) => path === "/api/tasks/archived"),
    ).toBe(false);
    const archiveHeading = await screen.findByRole("button", {
      name: "アーカイブを展開",
    });
    archiveHeading.click();

    await screen.findByText("Archived task");
    expect(screen.getByLabelText("「Archived task」を復元")).toBeTruthy();
    expect(screen.getByLabelText("「Archived task」を完全に削除")).toBeTruthy();
  });

  it("groups archived tasks by project order and sorts tasks by update time then id", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            { id: "prj2", name: "Same name", rootPath: "/second", favorite: false, lastOpenedAt: null },
            { id: "prj1", name: "Same name", rootPath: "/first", favorite: false, lastOpenedAt: null },
          ],
        });
      }
      if (path === "/api/tasks") return Promise.resolve({ tasks: [], engineOk: true });
      if (path === "/api/tasks/archived") {
        return Promise.resolve({
          tasks: [
            { id: "z-task", projectId: "prj1", title: "Z task", updatedAt: "2026-07-18T01:00:00Z", status: "merged", isolation: "current_folder", branch: null },
            { id: "a-task", projectId: "prj1", title: "A task", updatedAt: "2026-07-18T02:00:00Z", status: "merged", isolation: "current_folder", branch: null },
            { id: "second-task", projectId: "prj2", title: "Second task", updatedAt: "2026-07-18T03:00:00Z", status: "merged", isolation: "current_folder", branch: null },
            { id: "unknown-task", projectId: "missing", title: "Unknown task", updatedAt: "2026-07-18T04:00:00Z", status: "merged", isolation: "current_folder", branch: null },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);
    (await screen.findByRole("button", { name: "アーカイブを展開" })).click();

    const groups = await screen.findAllByTestId("archived-project-group");
    expect(groups).toHaveLength(3);
    // ヘッダーの折りたたみボタンがデフォルトで展開されているので、タスクリストが見える
    expect(within(groups[0]!).getByText("Second task")).toBeTruthy();
    // 2番目のグループ（prj1）も展開状態でタスクが見える
    const firstTaskButtons = within(groups[1]!)
      .getAllByRole("button")
      .filter((button) => button.textContent?.includes("task"));
    expect(firstTaskButtons).toHaveLength(2);
    expect(firstTaskButtons[0]?.textContent).toContain("A task");
    expect(firstTaskButtons[1]?.textContent).toContain("Z task");
  });

  it("restores an archived task", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({ projects: [] });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({ tasks: [], engineOk: true });
      }
      if (path === "/api/tasks/archived") {
        return Promise.resolve({
          tasks: [{
            id: "ws-archived",
            projectId: "prj1",
            projectName: "Repo",
            title: "Archived task",
            directory: "/repo",
            isolation: "current_folder",
            status: "merged",
            sessionId: null,
            branch: "main",
            additions: 0,
            deletions: 0,
            filesChanged: 0,
            createdAt: "2026-07-18T00:00:00Z",
            updatedAt: "2026-07-18T01:00:00Z",
          }],
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    // アーカイブセクションを展開
    const archiveHeading = await screen.findByRole("button", {
      name: "アーカイブを展開",
    });
    archiveHeading.click();

    await screen.findByText("Archived task");
    screen.getByLabelText("「Archived task」を復元").click();

    await vi.waitFor(() => {
      expect(sendJson).toHaveBeenCalledWith(
        "PATCH",
        "/api/tasks/ws-archived/restore",
      );
    });
  });

  it("shows archived-action failures inline without calling alert", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") return Promise.resolve({ projects: [] });
      if (path === "/api/tasks") return Promise.resolve({ tasks: [], engineOk: true });
      if (path === "/api/tasks/archived") {
        return Promise.resolve({
          tasks: [{
            id: "ws-archived",
            projectId: "prj1",
            projectName: "Repo",
            title: "Archived task",
            directory: "/repo",
            isolation: "current_folder",
            status: "merged",
            sessionId: null,
            branch: "main",
            additions: 0,
            deletions: 0,
            filesChanged: 0,
            createdAt: "2026-07-18T00:00:00Z",
            updatedAt: "2026-07-18T01:00:00Z",
          }],
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    sendJson.mockImplementation((method: string, path: string) =>
      path === "/api/tasks/ws-archived/restore"
        ? Promise.reject(new Error("restore denied"))
        : Promise.resolve({}),
    );

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);
    const archiveHeading = await screen.findByRole("button", {
      name: "アーカイブを展開",
    });
    archiveHeading.click();
    await screen.findByText("Archived task");
    screen.getByLabelText("「Archived task」を復元").click();

    expect((await screen.findByRole("alert")).textContent).toContain("restore denied");
    expect(alertSpy.mock.calls).toHaveLength(0);
  });

  it("locks a restore action against duplicate clicks", async () => {
    let resolveRestore: (() => void) | undefined;
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") return Promise.resolve({ projects: [] });
      if (path === "/api/tasks") return Promise.resolve({ tasks: [], engineOk: true });
      if (path === "/api/tasks/archived") {
        return Promise.resolve({
          tasks: [{
            id: "ws-archived",
            projectId: "prj1",
            projectName: "Repo",
            title: "Archived task",
            directory: "/repo",
            isolation: "current_folder",
            status: "merged",
            sessionId: null,
            branch: "main",
            additions: 0,
            deletions: 0,
            filesChanged: 0,
            createdAt: "2026-07-18T00:00:00Z",
            updatedAt: "2026-07-18T01:00:00Z",
          }],
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    sendJson.mockImplementation((method: string, path: string) =>
      path === "/api/tasks/ws-archived/restore"
        ? new Promise<void>((resolve) => { resolveRestore = resolve; })
        : Promise.resolve({}),
    );

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);
    (await screen.findByRole("button", { name: "アーカイブを展開" })).click();
    await screen.findByText("Archived task");
    const restore = screen.getByLabelText("「Archived task」を復元") as HTMLButtonElement;
    fireEvent.click(restore);
    await waitFor(() =>
      expect(
        sendJson.mock.calls.filter(([, path]) => path === "/api/tasks/ws-archived/restore"),
      ).toHaveLength(1),
    );
    expect(restore.disabled).toBe(true);
    expect(restore.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(restore);
    expect(
      sendJson.mock.calls.filter(([, path]) => path === "/api/tasks/ws-archived/restore"),
    ).toHaveLength(1);
    resolveRestore?.();
  });

  it("destroys an archived task after confirmation", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({ projects: [] });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({ tasks: [], engineOk: true });
      }
      if (path === "/api/tasks/archived") {
        return Promise.resolve({
          tasks: [{
            id: "ws-archived",
            projectId: "prj1",
            projectName: "Repo",
            title: "Archived task",
            directory: "/repo",
            isolation: "current_folder",
            status: "merged",
            sessionId: null,
            branch: "main",
            additions: 0,
            deletions: 0,
            filesChanged: 0,
            createdAt: "2026-07-18T00:00:00Z",
            updatedAt: "2026-07-18T01:00:00Z",
          }],
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    // アーカイブセクションを展開
    const archiveHeading = await screen.findByRole("button", {
      name: "アーカイブを展開",
    });
    archiveHeading.click();

    await screen.findByText("Archived task");
    screen.getByLabelText("「Archived task」を完全に削除").click();

    const deleteButton = screen
      .getAllByRole("button")
      .find((button) => button.className.includes("hover:bg-danger-bg"))!;
    const confirmation = await screen.findByRole("alertdialog");
    expect(document.activeElement).toBe(confirmation.querySelector("button"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    deleteButton.click();
    (await screen.findByRole("alertdialog")).querySelector("button")?.click();
    await vi.waitFor(() => {
      expect(sendJson).toHaveBeenCalledWith(
        "DELETE",
        "/api/tasks/ws-archived",
      );
    });
  });

  it("bulk-destroys all archived tasks in a project group after confirmation", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            { id: "prj1", name: "Repo", rootPath: "/repo", favorite: false, lastOpenedAt: null },
          ],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({ tasks: [], engineOk: true });
      }
      if (path === "/api/tasks/archived") {
        return Promise.resolve({
          tasks: [
            { id: "task-a", projectId: "prj1", title: "Task A", updatedAt: "2026-07-18T01:00:00Z", status: "merged", isolation: "current_folder", branch: null },
            { id: "task-b", projectId: "prj1", title: "Task B", updatedAt: "2026-07-18T02:00:00Z", status: "merged", isolation: "current_folder", branch: null },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    const archiveHeading = await screen.findByRole("button", {
      name: "アーカイブを展開",
    });
    archiveHeading.click();

    await screen.findByText("Task A");
    const groupDelete = screen.getByLabelText("Repoのアーカイブを一括削除");
    expect(groupDelete.className).toContain("h-9");
    expect(groupDelete.className).toContain("w-9");
    expect(groupDelete.className).toContain("md:h-6");
    groupDelete.click();

    (await screen.findByRole("alertdialog")).querySelector("button")?.click();
    await vi.waitFor(() => {
      expect(sendJson).toHaveBeenCalledWith("DELETE", "/api/tasks/task-a");
      expect(sendJson).toHaveBeenCalledWith("DELETE", "/api/tasks/task-b");
    });
  });
});

describe("Sidebar engine health polling", () => {
  let engineOk: boolean;

  beforeEach(() => {
    localStorage.clear();
    attentionState.items = [];
    attentionState.actionableItems = [];
    usePathname.mockReturnValue("/");
    engineOk = false;
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") return Promise.resolve({ projects: [] });
      if (path === "/api/tasks") return Promise.resolve({ tasks: [], engineOk });
      if (path === "/api/tasks/archived") return Promise.resolve({ tasks: [] });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("starts with a retrying notice before showing the engine-not-connected banner and self-clears", async () => {
    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    expect(
      await screen.findByText(
        "エンジン接続を確認中です。起動直後のため自動で再試行しています。",
      ),
    ).toBeTruthy();

    const banner = await screen.findByText(
      "エンジン未接続。自動で再確認中です。続く場合は設定またはトレイから OpenCode を再起動してください。",
      undefined,
      { timeout: 3000 },
    );
    expect(banner).toBeTruthy();

    // Engine becomes reachable; next 3s poll tick should clear the banner.
    engineOk = true;
    await waitFor(
      () => {
        expect(
          screen.queryByText(
            "エンジン未接続。自動で再確認中です。続く場合は設定またはトレイから OpenCode を再起動してください。",
          ),
        ).toBeNull();
        expect(
          screen.queryByText(
            "エンジン接続を確認中です。起動直後のため自動で再試行しています。",
          ),
        ).toBeNull();
      },
      { timeout: 8000 },
    );
  }, 15000);
});

describe("Sidebar DB persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    attentionState.items = [];
    attentionState.actionableItems = [];
    usePathname.mockReturnValue("/");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") return Promise.resolve({ projects: [] });
      if (path === "/api/tasks") return Promise.resolve({ tasks: [], engineOk: true });
      if (path === "/api/tasks/archived") return Promise.resolve({ tasks: [] });
      if (path === "/api/settings/sidebar") return Promise.resolve({ value: null });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    sendJson.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("migrates a localStorage-only sidebar state to the server on load", async () => {
    localStorage.setItem("webui.sidebar.expanded", JSON.stringify(["prj1"]));
    localStorage.setItem("webui.sidebar.width", "300");
    localStorage.setItem("webui.sidebar.archived_expanded", "true");

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/settings/sidebar",
        {
          value: JSON.stringify({
            expanded: ["prj1"],
            width: 300,
            archivedExpanded: true,
            archivedGroupsExpanded: [],
          }),
        },
      );
    });
  });

  it("prefers the server sidebar state over localStorage on load", async () => {
    localStorage.setItem("webui.sidebar.expanded", JSON.stringify(["local"]));
    localStorage.setItem("webui.sidebar.width", "200");
    localStorage.setItem("webui.sidebar.archived_expanded", "false");

    const remote = {
      expanded: ["prj-remote"],
      width: 400,
      archivedExpanded: true,
    };
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") return Promise.resolve({ projects: [] });
      if (path === "/api/tasks") return Promise.resolve({ tasks: [], engineOk: true });
      if (path === "/api/tasks/archived") return Promise.resolve({ tasks: [] });
      if (path === "/api/settings/sidebar") {
        return Promise.resolve({ value: JSON.stringify(remote) });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(localStorage.getItem("webui.sidebar.expanded")).toBe(
        JSON.stringify(["prj-remote"]),
      );
    });
    expect(localStorage.getItem("webui.sidebar.width")).toBe("400");
    expect(localStorage.getItem("webui.sidebar.archived_expanded")).toBe("true");
  });

  it("does not persist stale localStorage before server hydrate finishes", async () => {
    let resolveSidebar!: (value: { value: string }) => void;
    const sidebarDeferred = new Promise<{ value: string }>((resolve) => {
      resolveSidebar = resolve;
    });
    usePathname.mockReturnValue("/task/ws1");
    localStorage.setItem("webui.sidebar.expanded", JSON.stringify(["stale"]));
    localStorage.setItem("webui.sidebar.width", "200");

    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "prj-remote",
              name: "Repo",
              rootPath: "/repo",
              favorite: false,
              lastOpenedAt: null,
            },
          ],
        });
      }
      if (path === "/api/tasks") {
        return Promise.resolve({
          tasks: [
            {
              id: "ws1",
              projectId: "prj-remote",
              projectName: "Repo",
              title: "Task",
              directory: "/repo",
              isolation: "current_folder",
              status: "idle",
              sessionId: "sess1",
              branch: "main",
              additions: 0,
              deletions: 0,
              filesChanged: 0,
              cost: null,
              providerID: null,
              createdAt: "2026-07-18T00:00:00Z",
              updatedAt: "2026-07-18T00:00:00Z",
            },
          ],
          engineOk: true,
        });
      }
      if (path === "/api/tasks/archived") return Promise.resolve({ tasks: [] });
      if (path === "/api/settings/sidebar") return sidebarDeferred;
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(getJson).toHaveBeenCalledWith("/api/tasks");
    });
    // Active-task auto-expand would previously persist while hydrated=true and
    // overwrite the DB with stale localStorage before the remote read returned.
    expect(
      (sendJson.mock.calls as [string, string, unknown][]).some(
        ([method, url]) => method === "PUT" && url === "/api/settings/sidebar",
      ),
    ).toBe(false);

    resolveSidebar({
      value: JSON.stringify({
        expanded: ["prj-remote"],
        width: 400,
        archivedExpanded: true,
      }),
    });

    await waitFor(() => {
      expect(localStorage.getItem("webui.sidebar.expanded")).toBe(
        JSON.stringify(["prj-remote"]),
      );
    });
    expect(
      (sendJson.mock.calls as [string, string, unknown][]).some(
        ([method, url, body]) => {
          if (method !== "PUT" || url !== "/api/settings/sidebar") return false;
          const parsed = JSON.parse((body as { value: string }).value) as {
            expanded: string[];
          };
          return parsed.expanded.includes("stale") && !parsed.expanded.includes("prj-remote");
        },
      ),
    ).toBe(false);
  });

  it("writes the sidebar state to the DB when a project is toggled", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [{ id: "prj1", name: "Repo", rootPath: "/repo", favorite: false, lastOpenedAt: null }],
        });
      }
      if (path === "/api/tasks") return Promise.resolve({ tasks: [], engineOk: true });
      if (path === "/api/tasks/archived") return Promise.resolve({ tasks: [] });
      if (path === "/api/settings/sidebar") return Promise.resolve({ value: null });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    const expandBtn = await screen.findByLabelText("Repoを展開");
    fireEvent.click(expandBtn);

    await waitFor(() => {
      const sidebarPuts = (sendJson.mock.calls as [string, string, unknown][]).filter(
        ([method, url]) => method === "PUT" && url === "/api/settings/sidebar",
      );
      expect(sidebarPuts.length).toBeGreaterThanOrEqual(1);
      const last = sidebarPuts[sidebarPuts.length - 1]!;
      const parsed = JSON.parse((last[2] as { value: string }).value);
      expect(parsed.expanded).toContain("prj1");
    });
  });

  it("writes the sidebar state to the DB when the archived section is toggled", async () => {
    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    const archiveHeading = await screen.findByRole("button", {
      name: "アーカイブを展開",
    });
    fireEvent.click(archiveHeading);

    await waitFor(() => {
      const sidebarPuts = (sendJson.mock.calls as [string, string, unknown][]).filter(
        ([method, url]) => method === "PUT" && url === "/api/settings/sidebar",
      );
      expect(sidebarPuts.length).toBeGreaterThanOrEqual(1);
      const last = sidebarPuts[sidebarPuts.length - 1]!;
      const parsed = JSON.parse((last[2] as { value: string }).value);
      expect(parsed.archivedExpanded).toBe(true);
    });
  });
});
