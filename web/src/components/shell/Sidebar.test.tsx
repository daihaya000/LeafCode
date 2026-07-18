import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

const { getJson } = vi.hoisted(() => ({ getJson: vi.fn() }));

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

describe("Sidebar", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") return Promise.resolve({ projects: [] });
      if (path === "/api/tasks") return Promise.resolve({ tasks: [], engineOk: true });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });

  afterEach(() => {
    cleanup();
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

    expect(await screen.findByText("· $0.1234")).toBeTruthy();
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
});
