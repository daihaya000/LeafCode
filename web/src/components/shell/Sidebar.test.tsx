import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

const { getJson, attentionState } = vi.hoisted(() => ({
  getJson: vi.fn(),
  attentionState: {
    items: [] as Array<{
      kind: "question" | "permission";
      request: { sessionID: string };
    }>,
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
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
  sendJson: vi.fn(),
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

vi.mock("@/components/plugins/PluginHost", () => ({
  PluginHost: () => <div data-testid="plugin-host">Plugin widget</div>,
}));

vi.mock("./AttentionBadge", () => ({
  AttentionBadge: () => null,
}));

vi.mock("./GlobalAttentionProvider", () => ({
  useGlobalAttention: () => attentionState,
}));

describe("Sidebar", () => {
  beforeEach(() => {
    attentionState.items = [];
    usePathname.mockReturnValue("/");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") return Promise.resolve({ projects: [] });
      if (path === "/api/tasks") return Promise.resolve({ tasks: [], engineOk: true });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders plugins directly below the labelled add-project button", async () => {
    render(<Sidebar mobileOpen={false} onClose={vi.fn()} />);

    const addProject = await screen.findByTestId("add-project-button");
    const pluginHost = screen.getByTestId("plugin-host");

    expect(
      addProject.compareDocumentPosition(pluginHost) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("shows the session's cumulative cost next to the branch label", async () => {
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

    expect(await screen.findByText("· ¥18.5")).toBeTruthy();
  });

  it("refreshes a working task cost while the sidebar is visible", async () => {
    let calls = 0;
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
  });

  it("shows a warning dot when the task session is waiting for a question answer", async () => {
    attentionState.items = [{
      kind: "question",
      request: { sessionID: "sess1" },
    }];
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

    const spinner = await screen.findByLabelText("エージェントが処理中");
    expect(spinner.getAttribute("class")).toContain("animate-spin");
    expect(spinner.getAttribute("class")).toContain("text-working");
    expect(screen.queryByLabelText("質問への回答待ち")).toBeNull();
  });

  it("returns to the working spinner after the pending question is removed", async () => {
    attentionState.items = [{
      kind: "question",
      request: { sessionID: "sess1" },
    }];
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
});
