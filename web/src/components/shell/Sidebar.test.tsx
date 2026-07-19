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
    // Cost is after the provider icon (row ends with cost).
    expect(
      Array.from(row!.children).indexOf(provider.closest("span")!),
    ).toBeLessThan(Array.from(row!.children).indexOf(cost));
    expect(text.indexOf("main")).toBeLessThan(text.indexOf("¥18.5"));
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
});
