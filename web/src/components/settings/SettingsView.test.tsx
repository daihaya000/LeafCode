import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./SettingsView";

const { getJson, sendJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  getJson,
  sendJson,
}));

vi.mock("@/components/AddProjectButton", () => ({
  AddProjectButton: () => <button type="button">プロジェクトを追加</button>,
}));

vi.mock("@/components/plugins/PluginSettings", () => ({
  PluginSettings: () => <div data-testid="plugin-settings">plugins</div>,
}));

type OrphansPayload = {
  orphans: { id: string; displayName: string; absolutePath: string }[];
  stray: { projectId: string; projectName: string; path: string }[];
};

function mockGetJson(overrides?: Partial<{ orphans: OrphansPayload }>) {
  getJson.mockImplementation((path: string) => {
    if (path === "/api/health") {
      return Promise.resolve({ opencode: { ok: true, version: "1.0.0" } });
    }
    if (path === "/api/projects") return Promise.resolve({ projects: [] });
    if (path === "/api/roots") return Promise.resolve({ roots: [] });
    if (path === "/api/workspaces/orphans") {
      return Promise.resolve(
        overrides?.orphans ?? { orphans: [], stray: [] },
      );
    }
    if (path === "/api/access") {
      return Promise.resolve({
        bind: "0.0.0.0",
        port: 3000,
        localUrl: "http://localhost:3000",
        hint: "",
        addresses: [],
      });
    }
    return Promise.reject(new Error(`Unexpected getJson: ${path}`));
  });
}

function mockFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/opencode/mcp")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/api/host")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/api/opencode/provider")) {
        return new Response(
          JSON.stringify({ all: [], connected: [], default: {} }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

describe("SettingsView", () => {
  beforeEach(() => {
    getJson.mockReset();
    sendJson.mockReset();
    mockGetJson();
    mockFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows the 全般 tab by default and hides other tabs' content", async () => {
    render(<SettingsView />);

    await screen.findByText("エンジン");
    // "プロジェクト" appears as a tab label regardless of the active tab;
    // its section heading should NOT be rendered on the 全般 tab.
    expect(screen.queryAllByText("プロジェクト")).toHaveLength(1);
    expect(screen.queryByTestId("plugin-settings")).toBeNull();
  });

  it("switches visible content when a tab is clicked", async () => {
    render(<SettingsView />);
    await screen.findByText("エンジン");

    fireEvent.click(screen.getByRole("button", { name: "プラグイン" }));

    expect(await screen.findByTestId("plugin-settings")).toBeTruthy();
    expect(screen.queryByText("エンジン")).toBeNull();
  });

  it("shows an attention badge on the プロジェクト tab when orphans exist", async () => {
    mockGetJson({
      orphans: {
        orphans: [{ id: "o1", displayName: "orphan", absolutePath: "C:\\x" }],
        stray: [],
      },
    });
    render(<SettingsView />);

    await screen.findByText("エンジン");
    const projectTab = await screen.findByRole("button", {
      name: /プロジェクト/,
    });
    expect(projectTab.textContent).toContain("1");
  });
});
