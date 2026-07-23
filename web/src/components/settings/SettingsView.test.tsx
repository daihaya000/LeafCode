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

const { getJson, sendJson, timedFetch } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
  timedFetch: vi.fn(
    async (input: string, init?: RequestInit & { timeoutMs?: number }) => {
      const { timeoutMs, ...rest } = init ?? {};
      void timeoutMs;
      return fetch(input, { cache: "no-store", ...rest });
    },
  ),
}));

vi.mock("@/lib/client", () => ({
  getJson,
  sendJson,
  timedFetch,
}));

vi.mock("@/components/AddProjectButton", () => ({
  AddProjectButton: () => <button type="button">プロジェクトを追加</button>,
}));

vi.mock("@/components/addons/AddonSettings", () => ({
  AddonSettings: () => <div data-testid="addon-settings">addons</div>,
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

function mockFetch(
  handler?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Response | Promise<Response> | undefined,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const handled = await handler?.(input, init);
      if (handled) return handled;
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

function mockSettingsGetJson(roots: string[]) {
  getJson.mockImplementation((path: string) => {
    if (path === "/api/health") {
      return Promise.resolve({ opencode: { ok: true, version: "1.0.0" } });
    }
    if (path === "/api/projects") return Promise.resolve({ projects: [] });
    if (path === "/api/roots") return Promise.resolve({ roots: [...roots] });
    if (path === "/api/workspaces/orphans") {
      return Promise.resolve({ orphans: [], stray: [] });
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
    return Promise.reject(new Error(`Unexpected: ${path}`));
  });
}

describe("SettingsView", () => {
  beforeEach(() => {
    localStorage.clear();
    getJson.mockReset();
    sendJson.mockReset();
    timedFetch.mockClear();
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
    expect(screen.queryByTestId("addon-settings")).toBeNull();
  });

  it("switches visible content when a tab is clicked", async () => {
    render(<SettingsView />);
    await screen.findByText("エンジン");

    fireEvent.click(screen.getByRole("button", { name: "アドオン" }));

    expect(await screen.findByTestId("addon-settings")).toBeTruthy();
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

  it("posts an OpenCode restart request and announces progress after confirmation", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const restartRequests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    mockFetch((input, init) => {
      if (String(input).includes("/api/host/restart")) {
        restartRequests.push({ input, init });
        return new Response(JSON.stringify({ ok: true }), { status: 202 });
      }
      return undefined;
    });

    render(<SettingsView />);

    await screen.findByText("ホスト接続中");
    fireEvent.click(screen.getByRole("button", { name: "OpenCode を再起動" }));

    await waitFor(() => expect(restartRequests).toHaveLength(1));
    const [restartRequest] = restartRequests;
    expect(confirm).toHaveBeenCalledWith(
      "OpenCode（バックエンド）を再起動しますか？",
    );
    expect(restartRequest.input).toBe("/api/host/restart");
    expect(restartRequest.init?.method).toBe("POST");
    expect(JSON.parse(String(restartRequest.init?.body))).toEqual({
      target: "opencode",
    });
    expect(screen.getByRole("status").textContent).toContain(
      "OpenCode（バックエンド）を再起動しています…",
    );
  });

  it("confirms the root path and removes the row after a successful delete", async () => {
    const roots = ["C:\\repo1"];
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    mockSettingsGetJson(roots);
    sendJson.mockImplementation(async () => {
      roots.splice(0, 1);
      return { roots: [] };
    });

    render(<SettingsView />);
    await screen.findByText("エンジン");

    fireEvent.click(screen.getByRole("button", { name: /プロジェクト/ }));
    const deleteBtn = await screen.findByRole("button", { name: /C:\\repo1を削除/ });
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith("許可ルート「C:\\repo1」を削除しますか？");
      expect(sendJson).toHaveBeenCalledWith("DELETE", "/api/roots", undefined, { path: "C:\\repo1" });
      expect(screen.queryByText("C:\\repo1")).toBeNull();
    });
  });

  it("marks only the root being deleted as busy", async () => {
    const roots = ["C:\\repo1", "C:\\repo2"];
    let resolveDelete: (() => void) | undefined;
    vi.stubGlobal("confirm", vi.fn(() => true));
    mockSettingsGetJson(roots);
    sendJson.mockImplementation(
      () => new Promise((resolve) => {
        resolveDelete = () => resolve({ roots });
      }),
    );

    render(<SettingsView />);
    fireEvent.click(await screen.findByRole("button", { name: /プロジェクト/ }));
    const firstDelete = await screen.findByRole("button", { name: /C:\\repo1を削除/ });
    const secondDelete = screen.getByRole("button", { name: /C:\\repo2を削除/ });
    fireEvent.click(firstDelete);

    await waitFor(() => {
      expect(firstDelete.getAttribute("aria-busy")).toBe("true");
      expect(firstDelete.textContent).toContain("削除中…");
      expect(secondDelete.getAttribute("aria-busy")).toBe("false");
      expect(secondDelete.textContent).not.toContain("削除中…");
    });

    resolveDelete?.();
  });

  it("keeps the root and announces a delete error", async () => {
    const roots = ["C:\\repo1"];
    vi.stubGlobal("confirm", vi.fn(() => true));
    mockSettingsGetJson(roots);
    sendJson.mockRejectedValue(new Error("削除に失敗しました"));

    render(<SettingsView />);
    fireEvent.click(await screen.findByRole("button", { name: /プロジェクト/ }));
    fireEvent.click(await screen.findByRole("button", { name: /C:\\repo1を削除/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("削除に失敗しました");
    expect(screen.getByText("C:\\repo1")).toBeTruthy();
  });

  it("refreshes the list and announces when the root was already deleted", async () => {
    const roots = ["C:\\repo1"];
    vi.stubGlobal("confirm", vi.fn(() => true));
    mockSettingsGetJson(roots);
    sendJson.mockImplementation(async () => {
      roots.splice(0, 1);
      throw Object.assign(new Error("/api/roots failed: 404"), { status: 404 });
    });

    render(<SettingsView />);
    fireEvent.click(await screen.findByRole("button", { name: /プロジェクト/ }));
    fireEvent.click(await screen.findByRole("button", { name: /C:\\repo1を削除/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("既に削除済みです");
    await waitFor(() => expect(screen.queryByText("C:\\repo1")).toBeNull());
    expect(getJson.mock.calls.filter(([path]) => path === "/api/roots")).toHaveLength(2);
  });

  it("does not send DELETE when root deletion is cancelled", async () => {
    const roots = ["C:\\repo1"];
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    mockSettingsGetJson(roots);

    render(<SettingsView />);
    fireEvent.click(await screen.findByRole("button", { name: /プロジェクト/ }));
    fireEvent.click(await screen.findByRole("button", { name: /C:\\repo1を削除/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(sendJson).not.toHaveBeenCalled();
    expect(screen.getByText("C:\\repo1")).toBeTruthy();
  });
});
