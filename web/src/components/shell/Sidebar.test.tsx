import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

const { getJson } = vi.hoisted(() => ({ getJson: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
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
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") return Promise.resolve({ projects: [] });
      if (path === "/api/tasks") return Promise.resolve({ tasks: [], engineOk: true });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });

  afterEach(() => {
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
});
