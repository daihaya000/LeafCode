import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
      if (url.includes("/api/fx/usd-jpy")) {
        return new Response(
          JSON.stringify({ rate: 156.2, asOf: "2026-07-19", source: "test" }),
          { status: 200 },
        );
      }
      if (url.includes("/api/opencode/agent")) {
        return new Response(
          JSON.stringify([
            {
              name: "a-explorer-openai-gpt-5",
              mode: "subagent",
              model: { providerID: "openai", modelID: "gpt-5" },
            },
          ]),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

describe("SettingsView", () => {
  beforeEach(() => {
    localStorage.clear();
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

  it("shows the エージェント tab and lists agents when selected", async () => {
    render(<SettingsView />);
    await screen.findByText("エンジン");

    fireEvent.click(screen.getByRole("button", { name: "エージェント" }));

    expect(await screen.findByRole("heading", { name: "Rank A" })).toBeTruthy();
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

  it("shows the daily rate and disables editing in auto mode", async () => {
    render(<SettingsView />);

    expect(await screen.findByText("本日 156.2円（2026-07-19）")).toBeTruthy();
    expect(screen.getByRole("spinbutton")).toHaveProperty("disabled", true);
  });

  it("keeps the latest auto-rate response when requests resolve out of order", async () => {
    const responses: {
      resolve: (response: Response) => void;
    }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/fx/usd-jpy")) {
          return new Promise<Response>((resolve) => responses.push({ resolve }));
        }
        if (url.includes("/api/opencode/mcp")) {
          return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
        }
        if (url.includes("/api/host")) {
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        }
        if (url.includes("/api/opencode/provider")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ all: [], connected: [], default: {} }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response("{}", { status: 404 }));
      }),
    );

    render(<SettingsView />);
    await waitFor(() => expect(responses).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "手動" }));
    fireEvent.click(screen.getByRole("button", { name: "自動（本日）" }));
    await waitFor(() => expect(responses).toHaveLength(2));

    await act(async () => {
      responses[1].resolve(
        new Response(JSON.stringify({ rate: 157.5, asOf: "2026-07-19" })),
      );
    });
    expect(await screen.findByText("本日 157.5円（2026-07-19）")).toBeTruthy();

    await act(async () => {
      responses[0].resolve(
        new Response(JSON.stringify({ rate: 155.1, asOf: "2026-07-18" })),
      );
    });
    await act(async () => {});

    expect(screen.queryByText("本日 155.1円（2026-07-18）")).toBeNull();
    expect(screen.getByText("本日 157.5円（2026-07-19）")).toBeTruthy();
  });
});
