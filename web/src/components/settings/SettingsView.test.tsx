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

const { getJson, sendJson, timedFetch, setTheme } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
  setTheme: vi.fn(),
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

vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: "dark",
    resolvedTheme: "dark",
    setTheme,
  }),
}));

vi.mock("@/components/AddProjectButton", () => ({
  AddProjectButton: () => <button type="button">プロジェクトを追加</button>,
}));

vi.mock("@/components/addons/AddonSettings", () => ({
  AddonSettings: () => <div data-testid="addon-settings">addons</div>,
}));

vi.mock("@/components/settings/ExtensionsSettings", () => ({
  ExtensionsSettings: ({ activeSection }: { activeSection: string }) => (
    <div data-testid={`extensions-${activeSection}`}>{activeSection}</div>
  ),
}));

vi.mock("@/components/settings/HostLogPanel", () => ({
  HostLogPanel: () => <div data-testid="host-log-panel">host-log-panel</div>,
}));

vi.mock("@/components/shell/ShellContext", () => ({
  useShellMobileNav: () => ({
    mobileNavOpen: false,
    openMobileNav: vi.fn(),
    closeMobileNav: vi.fn(),
  }),
}));

type OrphansPayload = {
  orphans: { id: string; displayName: string; absolutePath: string }[];
  stray: { projectId: string; projectName: string; path: string }[];
};

const AGENT_FIXTURE = {
  name: "a-explorer-openai-gpt-5",
  mode: "subagent",
  model: { providerID: "openai", modelID: "gpt-5" },
  enabled: true,
  toggleable: true,
};

type AccessPayload = {
  bind: string;
  port: number;
  localUrl: string;
  hint: string;
  addresses: {
    name: string;
    address: string;
    url: string;
    kind: "caddy" | "vpn" | "lan" | "other";
  }[];
  certificateUrls?: {
    name: string;
    address: string;
    url: string;
    kind: "vpn" | "lan" | "other";
  }[];
};

function mockGetJson(
  overrides?: Partial<{
    orphans: OrphansPayload;
    access: AccessPayload;
    projects: unknown[];
    archivedProjects: unknown[];
  }>,
) {
  getJson.mockImplementation((path: string) => {
    if (path === "/api/health") {
      return Promise.resolve({
        webui: { ok: true },
        opencode: { ok: true, version: "1.0.0" },
      });
    }
    if (path === "/api/projects") {
      return Promise.resolve({ projects: overrides?.projects ?? [] });
    }
    if (path === "/api/projects/archived") {
      return Promise.resolve({ projects: overrides?.archivedProjects ?? [] });
    }
    if (path === "/api/roots") return Promise.resolve({ roots: [] });
    if (path === "/api/extensions/agents") {
      return Promise.resolve({ agents: [AGENT_FIXTURE] });
    }
    if (path === "/api/extensions/provider-models") {
      return Promise.resolve({ providers: [] });
    }
    if (path === "/api/workspaces/orphans") {
      return Promise.resolve(
        overrides?.orphans ?? { orphans: [], stray: [] },
      );
    }
    if (path === "/api/access") {
      return Promise.resolve(
        overrides?.access ?? {
          bind: "0.0.0.0",
          port: 3000,
          localUrl: "http://localhost:3000",
          hint: "",
          addresses: [],
        },
      );
    }
    if (path === "/api/settings/default-model") {
      return Promise.resolve({ value: null });
    }
    if (path === "/api/auth/users") {
      return Promise.resolve({
        users: [
          { username: "admin", role: "admin", updatedAt: "2026-01-01T00:00:00.000Z" },
          { username: "guest", role: "user", updatedAt: "2026-01-02T00:00:00.000Z" },
        ],
      });
    }
    if (path === "/api/auth/config") {
      return Promise.resolve({
        windowsAuth: false,
        windowsAuthSupported: true,
        hasUsers: true,
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
    if (path === "/api/projects/archived")
      return Promise.resolve({ projects: [] });
    if (path === "/api/roots") return Promise.resolve({ roots: [...roots] });
    if (path === "/api/extensions/agents") {
      return Promise.resolve({ agents: [AGENT_FIXTURE] });
    }
    if (path === "/api/extensions/provider-models") {
      return Promise.resolve({ providers: [] });
    }
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
    if (path === "/api/settings/default-model") {
      return Promise.resolve({ value: null });
    }
    return Promise.reject(new Error(`Unexpected: ${path}`));
  });
}

function mockUpdateStatus() {
  getJson.mockImplementation((path: string) => {
    if (path === "/api/health") return Promise.resolve({ webui: { ok: true }, opencode: { ok: true } });
    if (path === "/api/projects") return Promise.resolve({ projects: [] });
    if (path === "/api/projects/archived")
      return Promise.resolve({ projects: [] });
    if (path === "/api/roots") return Promise.resolve({ roots: [] });
    if (path === "/api/workspaces/orphans") return Promise.resolve({ orphans: [], stray: [] });
    if (path === "/api/access") return Promise.resolve({ bind: "127.0.0.1", port: 3000, localUrl: "http://localhost:3000", hint: "", addresses: [] });
    if (path === "/api/updates/status") {
      return Promise.resolve({
        webui: { available: false, current: "abc1234", currentDate: "2026/08/10 12:00" },
        opencode: { available: false, current: "1.18.14" },
        nextjs: { available: false, current: "16.3.0" },
      });
    }
    return Promise.reject(new Error(`Unexpected getJson: ${path}`));
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

  it("keeps a mobile nav menu entry that controls the drawer", async () => {
    render(<SettingsView />);
    const menu = await screen.findByLabelText("メニュー");
    expect(menu.getAttribute("aria-controls")).toBe("mobile-nav");
    expect(menu.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the エンジン tab by default and hides other tabs' content", async () => {
    render(<SettingsView />);

    await screen.findByText("接続状態");
    // "プロジェクト" appears as a tab label regardless of the active tab;
    // its section heading should NOT be rendered on the エンジン tab.
    expect(screen.queryAllByText("プロジェクト")).toHaveLength(1);
    expect(screen.queryByTestId("addon-settings")).toBeNull();
    expect(screen.queryByTestId("host-log-panel")).toBeNull();
  });

  it("switches the OpenCode API generation from the engine tab", async () => {
    const settingsWrites: string[] = [];
    mockFetch((input, init) => {
      if (
        String(input).includes("/api/settings/opencode-api-generation") &&
        init?.method === "PUT"
      ) {
        settingsWrites.push(String(input));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return undefined;
    });

    render(<SettingsView />);

    await screen.findByText("接続状態");
    const v2 = screen.getByRole("radio", { name: /v2（\/api\/\* 面）/ }) as HTMLInputElement;
    expect(v2.checked).toBe(false);

    fireEvent.click(v2);

    expect((screen.getByRole("radio", { name: /v2（\/api\/\* 面）/ }) as HTMLInputElement).checked).toBe(true);
    expect(window.localStorage.getItem("webui:opencode-api-generation")).toBe("v2");
    // The durable server copy is written in the background.
    await waitFor(() => {
      expect(settingsWrites).toHaveLength(1);
    });
  });

  it("exposes the mobile-scrollable settings categories as a tablist", async () => {
    render(<SettingsView />);

    const tablist = await screen.findByRole("tablist", { name: "設定カテゴリ" });

    expect(tablist.getAttribute("tabindex")).toBe("0");
    expect(tablist.className).toContain("overflow-x-auto");
    expect(screen.getByRole("tab", { name: "エンジン" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("shows current component versions even when no updates are available", async () => {
    mockUpdateStatus();
    render(<SettingsView />);

    expect(await screen.findByText("現在のバージョン")).toBeTruthy();
    expect(screen.getByText(/LeafCode: コミット abc1234/)).toBeTruthy();
    expect(screen.getByText("OpenCode CLI: バージョン 1.18.14")).toBeTruthy();
    expect(screen.getByText("Next.js: バージョン 16.3.0")).toBeTruthy();
    expect(screen.queryByText("利用可能なアップデート")).toBeNull();
  });

  it("supports roving keyboard navigation across settings tabs", async () => {
    render(<SettingsView />);

    const tabs = await screen.findAllByRole("tab");
    const engineTab = tabs.find(
      (t) => t.getAttribute("aria-controls") === "settings-panel-engine",
    )!;
    expect(engineTab.getAttribute("tabindex")).toBe("0");
    const generalTab = tabs.find(
      (t) => t.getAttribute("aria-controls") === "settings-panel-general",
    )!;
    expect(generalTab.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      "settings-tab-engine",
    );

    fireEvent.keyDown(engineTab, { key: "ArrowRight" });
    expect(generalTab.getAttribute("aria-selected")).toBe("true");
    expect(engineTab.getAttribute("tabindex")).toBe("-1");
    expect(generalTab.getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tabpanel").id).toBe("settings-panel-general");

    fireEvent.keyDown(generalTab, { key: "End" });
    expect(tabs.at(-1)?.getAttribute("aria-selected")).toBe("true");
  });

  it("switches visible content when a tab is clicked", async () => {
    render(<SettingsView />);
    await screen.findByText("エンジン");

    fireEvent.click(screen.getByRole("tab", { name: "アドオン" }));

    expect(await screen.findByTestId("addon-settings")).toBeTruthy();
    expect(screen.queryByText("接続状態")).toBeNull();
  });

  it("shows the admin/user role badge for each registered account", async () => {
    render(<SettingsView />);
    await screen.findByText("エンジン");

    fireEvent.click(screen.getByRole("tab", { name: "ユーザー" }));

    await screen.findByText("admin");
    expect(screen.getByText("guest")).toBeTruthy();
    expect(screen.getByText("管理者")).toBeTruthy();
    expect(screen.getByText("一般")).toBeTruthy();
  });

  it("shows theme switching inside the 全般 tab", async () => {
    render(<SettingsView />);

    fireEvent.click(await screen.findByRole("tab", { name: "全般" }));
    expect(await screen.findByRole("heading", { name: "表示テーマ" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "テーマ" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /ライト/ }));
    expect(setTheme).toHaveBeenCalledWith("light");
  });

  it("exposes token-saving mode and threshold settings", async () => {
    render(<SettingsView />);

    fireEvent.click(await screen.findByRole("tab", { name: "全般" }));
    const mode = await screen.findByRole("combobox", {
      name: "トークン節約モード",
    });
    expect((mode as HTMLSelectElement).value).toBe("off");

    fireEvent.change(mode, { target: { value: "auto" } });
    expect(localStorage.getItem("webui:token-saving")).toBe("auto");

    const threshold = screen.getByRole("spinbutton", {
      name: "コンテキスト使用率の閾値",
    });
    fireEvent.change(threshold, { target: { value: "85" } });
    fireEvent.blur(threshold);
    expect(localStorage.getItem("webui:token-saving-threshold")).toBe("85");
    await waitFor(() => {
      expect(sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/settings/token-saving",
        { value: "auto" },
      );
      expect(sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/settings/token-saving-threshold",
        { value: "85" },
      );
    });
  });

  it("keeps an edited threshold across tab switches (no draft loss)", async () => {
    render(<SettingsView />);

    fireEvent.click(await screen.findByRole("tab", { name: "全般" }));
    const threshold = screen.getByRole("spinbutton", {
      name: "コンテキスト使用率の閾値",
    });
    fireEvent.change(threshold, { target: { value: "88" } });
    fireEvent.blur(threshold);

    // Switching away and back must not lose the committed draft.
    fireEvent.click(screen.getByRole("tab", { name: "エンジン" }));
    fireEvent.click(screen.getByRole("tab", { name: "全般" }));

    expect(
      (
        screen.getByRole("spinbutton", {
          name: "コンテキスト使用率の閾値",
        }) as HTMLInputElement
      ).value,
    ).toBe("88");
  });

  it("exposes selected cost display options as pressed toggle buttons", async () => {
    render(<SettingsView />);

    fireEvent.click(await screen.findByRole("tab", { name: "全般" }));
    await screen.findByRole("heading", { name: "表示テーマ" });
    const currencyButtons = screen
      .getAllByRole("button")
      .filter((button) => button.textContent?.includes("$") || button.textContent?.includes("円"));
    expect(currencyButtons.length).toBe(2);
    expect(currencyButtons.filter((button) => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);

    const rateButtons = screen
      .getAllByRole("button")
      .filter((button) => /自動|手動/.test(button.textContent ?? ""));
    expect(rateButtons).toHaveLength(2);
    expect(rateButtons.filter((button) => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
  });

  it("shows the エージェント tab and lists agents when selected", async () => {
    render(<SettingsView />);
    await screen.findByRole("tab", { name: "エンジン" });

    fireEvent.click(screen.getByRole("tab", { name: "エージェント" }));

    expect(await screen.findByRole("heading", { name: "Rank A" })).toBeTruthy();
    expect(screen.queryByText("接続状態")).toBeNull();
  });

  it("orders the settings tabs by category", async () => {
    render(<SettingsView />);
    await screen.findByText("エンジン");

    expect(
      screen.getAllByRole("tab").map((button) => button.textContent),
    ).toEqual(
      expect.arrayContaining([
        "エンジン",
        "全般",
        "プロファイル",
        "プロジェクト",
        "接続",
        "Git",
        "プロバイダー/モデル",
        "コスパランキング",
        "エージェント",
        "スキル",
        "MCP",
        "プラグイン",
        "アドオン",
      ]),
    );
    const tabLabels = screen
      .getAllByRole("tab")
      .map((button) => button.textContent ?? "")
      .filter((label) =>
        [
          "エンジン",
          "全般",
          "プロファイル",
          "プロジェクト",
          "接続",
          "Git",
          "プロバイダー/モデル",
          "コスパランキング",
          "エージェント",
          "スキル",
          "MCP",
          "プラグイン",
          "アドオン",
        ].includes(label),
      );
    expect(tabLabels).toEqual([
      "エンジン",
      "全般",
      "プロファイル",
      "プロジェクト",
      "接続",
      "Git",
      "プロバイダー/モデル",
      "コスパランキング",
      "エージェント",
      "スキル",
      "MCP",
      "プラグイン",
      "アドオン",
    ]);
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
    const projectTab = await screen.findByRole("tab", {
      name: /プロジェクト/,
    });
    expect(projectTab.textContent).toContain("1");
  });

  it("shows the daily rate and disables editing in auto mode", async () => {
    render(<SettingsView />);

    fireEvent.click(await screen.findByRole("tab", { name: "全般" }));
    expect(await screen.findByText("本日 156.2円（2026-07-19）")).toBeTruthy();
    expect(
      screen.getByRole("spinbutton", { name: "USD/JPY レート" }),
    ).toHaveProperty("disabled", true);
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

    fireEvent.click(await screen.findByRole("tab", { name: "全般" }));
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

  it("posts an OpenCode restart request and announces progress after inline confirmation", async () => {
    const restartRequests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    mockFetch((input, init) => {
      if (String(input).includes("/api/host/restart")) {
        restartRequests.push({ input, init });
        return new Response(JSON.stringify({ ok: true }), { status: 202 });
      }
      return undefined;
    });

    render(<SettingsView />);

    await screen.findByRole("tab", { name: "エンジン" });
    fireEvent.click(screen.getByRole("tab", { name: "エンジン" }));
    await screen.findByText("LeafCode 接続中");
    fireEvent.click(screen.getByRole("button", { name: "OpenCode を再起動" }));
    expect(screen.getByRole("dialog", { name: "再起動の確認" })).toBeTruthy();
    expect(
      screen.getByText("OpenCode（バックエンド）を再起動しますか？"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "再起動する" }));

    await waitFor(() => expect(restartRequests).toHaveLength(1));
    const [restartRequest] = restartRequests;
    expect(restartRequest.input).toBe("/api/host/restart");
    expect(restartRequest.init?.method).toBe("POST");
    expect(JSON.parse(String(restartRequest.init?.body))).toEqual({
      target: "opencode",
    });
    expect(screen.getByRole("status").textContent).toContain(
      "OpenCode（バックエンド）を再起動しています…",
    );
  });

  it("shows a visible inline confirmation before restarting WebUI", async () => {
    const restartRequests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    mockFetch((input, init) => {
      if (String(input).includes("/api/host/restart")) {
        restartRequests.push({ input, init });
        return new Response(JSON.stringify({ ok: true }), { status: 202 });
      }
      return undefined;
    });

    render(<SettingsView />);

    await screen.findByRole("tab", { name: "エンジン" });
    fireEvent.click(screen.getByRole("tab", { name: "エンジン" }));
    await screen.findByText("LeafCode 接続中");
    fireEvent.click(screen.getByRole("button", { name: "LeafCode を再起動" }));
    expect(screen.getByRole("dialog", { name: "再起動の確認" })).toBeTruthy();
    expect(
      screen.getByText("LeafCode（フロントエンド）を再起動しますか？"),
    ).toBeTruthy();
    expect(restartRequests).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("dialog", { name: "再起動の確認" })).toBeNull();
  });

  it("treats opencode target success as opencode.ok === true", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const healthResponses: Response[] = [
      new Response(
        JSON.stringify({ webui: { ok: true }, opencode: { ok: false } }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({ webui: { ok: true }, opencode: { ok: true } }),
        { status: 200 },
      ),
    ];
    let healthPolls = 0;
    mockFetch((input) => {
      if (String(input).includes("/api/host/restart")) {
        return new Response(JSON.stringify({ ok: true }), { status: 202 });
      }
      if (String(input).includes("/api/health")) {
        healthPolls += 1;
        return healthResponses.shift() ?? new Response("{}", { status: 200 });
      }
      return undefined;
    });

    render(<SettingsView />);
    await screen.findByRole("tab", { name: "エンジン" });
    fireEvent.click(screen.getByRole("tab", { name: "エンジン" }));
    await screen.findByText("LeafCode 接続中");
    fireEvent.click(screen.getByRole("button", { name: "OpenCode を再起動" }));
    fireEvent.click(screen.getByRole("button", { name: "再起動する" }));

    await waitFor(() => {
      expect(screen.queryByRole("status")?.textContent).not.toContain(
        "再起動しています",
      );
    }, { timeout: 3000 });
    expect(healthPolls).toBe(2);
  });

  it("archives a project via the archive button", async () => {
    const projects = [
      {
        id: "prj1",
        name: "Repo",
        rootPath: "C:\\repo",
        favorite: false,
        archived: false,
        lastOpenedAt: null,
      },
    ];
    mockGetJson({ projects });
    sendJson.mockImplementation(async () => {
      projects.splice(0, 1);
      return {};
    });

    render(<SettingsView />);
    await screen.findByText("エンジン");
    fireEvent.click(screen.getByRole("tab", { name: /プロジェクト/ }));

    expect(
      await screen.findByRole("button", { name: "Repoをお気に入りに追加" }),
    ).toBeTruthy();
    const archiveButton = await screen.findByRole("button", {
      name: "Repoをアーカイブ",
    });
    fireEvent.click(archiveButton);

    await waitFor(() => {
      expect(sendJson).toHaveBeenCalledWith(
        "PATCH",
        "/api/projects/prj1/archive",
      );
    });
  });

  it("confirms the root path and removes the row after a successful delete", async () => {
    const roots = ["C:\\repo1"];
    mockSettingsGetJson(roots);
    sendJson.mockImplementation(async () => {
      roots.splice(0, 1);
      return { roots: [] };
    });

    render(<SettingsView />);
    await screen.findByText("エンジン");

    fireEvent.click(screen.getByRole("tab", { name: /プロジェクト/ }));
    const deleteBtn = await screen.findByRole("button", { name: /C:\\repo1を削除/ });
    deleteBtn.focus();
    fireEvent.click(deleteBtn);

    const dialog = await screen.findByRole("alertdialog");
    expect(document.activeElement).toBe(dialog.querySelector("button"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(deleteBtn);
    (await screen.findByRole("alertdialog")).querySelector("button")?.click();
    await waitFor(() => {
      expect(sendJson).toHaveBeenCalledWith("DELETE", "/api/roots", undefined, { path: "C:\\repo1" });
      expect(screen.queryByText("C:\\repo1")).toBeNull();
    });
  });

  it("marks only the root being deleted as busy", async () => {
    const roots = ["C:\\repo1", "C:\\repo2"];
    let resolveDelete: (() => void) | undefined;
    mockSettingsGetJson(roots);
    sendJson.mockImplementation(
      () => new Promise((resolve) => {
        resolveDelete = () => resolve({ roots });
      }),
    );

    render(<SettingsView />);
    fireEvent.click(await screen.findByRole("tab", { name: /プロジェクト/ }));
    const firstDelete = await screen.findByRole("button", { name: /C:\\repo1を削除/ });
    const secondDelete = screen.getByRole("button", { name: /C:\\repo2を削除/ });
    fireEvent.click(firstDelete);
    (await screen.findByRole("alertdialog")).querySelector("button")?.click();

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
    mockSettingsGetJson(roots);
    sendJson.mockRejectedValue(new Error("削除に失敗しました"));

    render(<SettingsView />);
    fireEvent.click(await screen.findByRole("tab", { name: /プロジェクト/ }));
    fireEvent.click(await screen.findByRole("button", { name: /C:\\repo1を削除/ }));
    (await screen.findByRole("alertdialog")).querySelector("button")?.click();

    expect((await screen.findByRole("alert")).textContent).toContain("削除に失敗しました");
    expect(screen.getByText("C:\\repo1")).toBeTruthy();
  });

  it("refreshes the list and announces when the root was already deleted", async () => {
    const roots = ["C:\\repo1"];
    mockSettingsGetJson(roots);
    sendJson.mockImplementation(async () => {
      roots.splice(0, 1);
      throw Object.assign(new Error("/api/roots failed: 404"), { status: 404 });
    });

    render(<SettingsView />);
    fireEvent.click(await screen.findByRole("tab", { name: /プロジェクト/ }));
    fireEvent.click(await screen.findByRole("button", { name: /C:\\repo1を削除/ }));
    (await screen.findByRole("alertdialog")).querySelector("button")?.click();

    expect((await screen.findByRole("alert")).textContent).toContain("既に削除済みです");
    await waitFor(() => expect(screen.queryByText("C:\\repo1")).toBeNull());
    expect(getJson.mock.calls.filter(([path]) => path === "/api/roots")).toHaveLength(2);
  });

  it("does not send DELETE when root deletion is cancelled", async () => {
    const roots = ["C:\\repo1"];
    mockSettingsGetJson(roots);

    render(<SettingsView />);
    fireEvent.click(await screen.findByRole("tab", { name: /プロジェクト/ }));
    fireEvent.click(await screen.findByRole("button", { name: /C:\\repo1を削除/ }));

    const dialog = await screen.findByRole("alertdialog");
    dialog.querySelectorAll("button")[1]?.click();
    expect(sendJson).not.toHaveBeenCalled();
    expect(screen.getByText("C:\\repo1")).toBeTruthy();
  });

  it("shows the スキル, MCP and プラグイン tabs and renders the matching section", async () => {
    render(<SettingsView />);
    await screen.findByText("エンジン");

    fireEvent.click(screen.getByRole("tab", { name: "スキル" }));
    expect(await screen.findByTestId("extensions-skills")).toBeTruthy();
    expect(screen.queryByText("接続状態")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "MCP" }));
    expect(await screen.findByTestId("extensions-mcp")).toBeTruthy();
    expect(screen.queryByTestId("extensions-skills")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "プラグイン" }));
    expect(await screen.findByTestId("extensions-plugins")).toBeTruthy();
    expect(screen.queryByTestId("extensions-mcp")).toBeNull();
  });

  it("does not duplicate MCP server settings in the connectivity tab", async () => {
    render(<SettingsView />);
    await screen.findByText("エンジン");

    fireEvent.click(screen.getByRole("tab", { name: "接続" }));
    await screen.findByText("スマホ / VPN アクセス");
    expect(screen.queryByRole("heading", { name: "MCP サーバー" })).toBeNull();
    expect(screen.queryByRole("button", { name: "MCPタブを開く" })).toBeNull();
  });

  it("shows Caddy, direct URLs, and trust certificate downloads", async () => {
    mockGetJson({
      access: {
        bind: "0.0.0.0",
        port: 3000,
        localUrl: "http://localhost:3000",
        hint: "Caddy 経由の HTTPS で公開中です。",
        addresses: [
          {
            name: "Caddy (HTTPS)",
            address: "https://webui.example.com",
            url: "https://webui.example.com",
            kind: "caddy",
          },
          {
            name: "Tailscale",
            address: "100.64.0.10",
            url: "http://100.64.0.10:3000",
            kind: "vpn",
          },
        ],
        certificateUrls: [
          {
            name: "Tailscale",
            address: "100.64.0.10",
            url: "http://100.64.0.10:8080/caddy-root.crt",
            kind: "vpn",
          },
        ],
      },
    });

    render(<SettingsView />);
    await screen.findByText("エンジン");
    fireEvent.click(screen.getByRole("tab", { name: "接続" }));

    expect(await screen.findByText("https://webui.example.com")).toBeTruthy();
    expect(screen.getByText("http://100.64.0.10:3000")).toBeTruthy();
    // Caddy + Tailscale(VPN) + Localhost(常時追加)
    expect(screen.getAllByRole("button", { name: "URLをコピー" })).toHaveLength(3);
    expect(screen.getByRole("link", { name: "https://webui.example.com" }).getAttribute("target")).toBe("_blank");
    const dl = screen.getByRole("link", {
      name: "VPN接続の端末用CA証明書をダウンロード",
    });
    expect(dl.getAttribute("href")).toBe(
      "http://100.64.0.10:8080/caddy-root.crt",
    );
    expect(dl.getAttribute("download")).toBe("caddy-root.crt");
  });

  it("hides Wi-Fi/LAN direct links and always shows the localhost link", async () => {
    mockGetJson({
      access: {
        bind: "0.0.0.0",
        port: 3000,
        localUrl: "http://127.0.0.1:3000",
        hint: "",
        addresses: [
          {
            name: "Wi-Fi",
            address: "192.168.1.100",
            url: "http://192.168.1.100:3000",
            kind: "lan",
          },
        ],
      },
    });

    render(<SettingsView />);
    await screen.findByText("エンジン");
    fireEvent.click(screen.getByRole("tab", { name: "接続" }));

    expect(await screen.findByText("http://127.0.0.1:3000")).toBeTruthy();
    expect(screen.queryByText("http://192.168.1.100:3000")).toBeNull();
  });

  it("allows firewall port access from the connectivity tab", async () => {
    mockGetJson({
      access: {
        bind: "0.0.0.0",
        port: 3000,
        localUrl: "http://127.0.0.1:3000",
        hint: "",
        addresses: [],
      },
    });
    sendJson.mockImplementation((_method: string, path: string) => {
      if (path === "/api/host/allow-firewall") {
        return Promise.resolve({ alreadyExists: false, port: 3000 });
      }
      return Promise.reject(new Error(`Unexpected sendJson: ${path}`));
    });

    render(<SettingsView />);
    await screen.findByText("エンジン");
    fireEvent.click(screen.getByRole("tab", { name: "接続" }));

    fireEvent.click(await screen.findByRole("button", { name: "ポートを許可" }));

    await waitFor(() => {
      expect(sendJson).toHaveBeenCalledWith(
        "POST",
        "/api/host/allow-firewall",
        {},
        undefined,
        { timeoutMs: 70_000 },
      );
    });
    expect(
      await screen.findByText("ファイアウォールでポート 3000 番を許可しました"),
    ).toBeTruthy();
  });

  it("shows an error message when allowing the firewall port fails", async () => {
    mockGetJson({
      access: {
        bind: "0.0.0.0",
        port: 3000,
        localUrl: "http://127.0.0.1:3000",
        hint: "",
        addresses: [],
      },
    });
    sendJson.mockImplementation((_method: string, path: string) => {
      if (path === "/api/host/allow-firewall") {
        return Promise.reject(new Error("UAC がキャンセルされました"));
      }
      return Promise.reject(new Error(`Unexpected sendJson: ${path}`));
    });

    render(<SettingsView />);
    await screen.findByText("エンジン");
    fireEvent.click(screen.getByRole("tab", { name: "接続" }));

    fireEvent.click(await screen.findByRole("button", { name: "ポートを許可" }));

    expect(await screen.findByText("UAC がキャンセルされました")).toBeTruthy();
  });

  it("loads default model settings only in the プロバイダー/モデル tab", async () => {
    localStorage.setItem("webui:default-model", "local::model");
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/default-model") {
        return Promise.resolve({ value: "openai::gpt-5" });
      }
      if (path === "/api/health") {
        return Promise.resolve({ opencode: { ok: true, version: "1.0.0" } });
      }
      if (path === "/api/projects") return Promise.resolve({ projects: [] });
      if (path === "/api/projects/archived")
        return Promise.resolve({ projects: [] });
      if (path === "/api/roots") return Promise.resolve({ roots: [] });
      if (path === "/api/extensions/agents") {
        return Promise.resolve({ agents: [AGENT_FIXTURE] });
      }
      if (path === "/api/extensions/provider-models") {
        return Promise.resolve({
          providers: [
            {
              id: "openai",
              name: "OpenAI",
              enabled: true,
              models: [{ id: "gpt-5", name: "GPT-5", enabled: true }],
            },
          ],
        });
      }
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

    render(<SettingsView />);
    await screen.findByText("エンジン");
    expect(screen.queryByRole("heading", { name: "デフォルトモデル" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "プロバイダー/モデル" }));

    expect(
      await screen.findByRole("heading", { name: "デフォルトモデル" }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(localStorage.getItem("webui:default-model")).toBe("openai::gpt-5");
    });
  });

});
