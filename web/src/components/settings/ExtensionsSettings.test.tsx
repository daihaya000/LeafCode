import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionsSettings } from "./ExtensionsSettings";

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

const SKILLS = [
  {
    id: "alpha",
    name: "alpha",
    description: "Alpha skill",
    enabled: true,
    toggleable: true,
  },
  { id: "beta", name: "beta", enabled: false, toggleable: true },
];

const SERVERS = [
  {
    id: "blender",
    name: "blender",
    type: "local",
    detail: "uvx blender-mcp",
    enabled: true,
    pendingRestart: false,
    engineAvailable: true,
    runtime: "connected",
  },
];

const PLUGINS = [
  { id: "config:aaaaaaaaaaaaaaaa.0", name: "plug-a", kind: "config", enabled: true },
  { id: "local:x.js", name: "x.js", kind: "local", enabled: true },
];

function mockGetJson(overrides?: { skillsFail?: boolean; emptySkills?: boolean }) {
  getJson.mockImplementation((path: string) => {
    if (path === "/api/extensions/skills") {
      if (overrides?.skillsFail) {
        return Promise.reject(new Error("スキル一覧を取得できません"));
      }
      return Promise.resolve({ skills: overrides?.emptySkills ? [] : SKILLS });
    }
    if (path === "/api/extensions/mcp") {
      return Promise.resolve({ servers: SERVERS });
    }
    if (path === "/api/extensions/plugins") {
      return Promise.resolve({ plugins: PLUGINS });
    }
    if (path === "/api/health") {
      return Promise.resolve({ opencode: { ok: true } });
    }
    return Promise.reject(new Error(`Unexpected getJson: ${path}`));
  });
}

function mockFetch(hostOk: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/host/restart")) {
        return new Response(JSON.stringify({ ok: true }), { status: 202 });
      }
      if (url.includes("/api/host")) {
        return new Response(JSON.stringify({ ok: hostOk }), { status: 200 });
      }
      if (url.includes("/api/health")) {
        return new Response(JSON.stringify({ opencode: { ok: true } }), {
          status: 200,
        });
      }
      void init;
      return new Response("{}", { status: 404 });
    }),
  );
}

beforeEach(() => {
  getJson.mockReset();
  sendJson.mockReset();
  sendJson.mockResolvedValue({ ok: true });
  timedFetch.mockClear();
  mockGetJson();
  mockFetch(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ExtensionsSettings", () => {
  it("lists skills, MCP servers and plugins with accessible switches", async () => {
    render(<ExtensionsSettings />);

    expect(await screen.findByRole("heading", { name: "Skills" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "MCP サーバー" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "プラグイン" })).toBeTruthy();

    const alphaSwitch = screen.getByRole("switch", { name: "alpha を無効化" });
    expect(alphaSwitch.getAttribute("aria-checked")).toBe("true");
    const betaSwitch = screen.getByRole("switch", { name: "beta を有効化" });
    expect(betaSwitch.getAttribute("aria-checked")).toBe("false");

    // Status is conveyed as text, not color alone.
    expect(screen.getByText("接続中")).toBeTruthy();
    expect(screen.getByText("設定済み")).toBeTruthy();
    expect(screen.getByText("ローカル自動読込")).toBeTruthy();
  });

  it("toggles a skill and shows a single restart banner", async () => {
    render(<ExtensionsSettings />);
    const alphaSwitch = await screen.findByRole("switch", { name: "alpha を無効化" });

    fireEvent.click(alphaSwitch);

    await waitFor(() => expect(sendJson).toHaveBeenCalledTimes(1));
    expect(sendJson).toHaveBeenCalledWith(
      "PATCH",
      "/api/extensions/skills/alpha",
      { enabled: false },
    );
    expect(
      await screen.findByText("変更を反映するには OpenCode の再起動が必要です。"),
    ).toBeTruthy();
  });

  it("marks only the toggled row as busy", async () => {
    let resolveToggle: (() => void) | undefined;
    sendJson.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveToggle = () => resolve({ ok: true });
        }),
    );

    render(<ExtensionsSettings />);
    const alphaSwitch = await screen.findByRole("switch", { name: "alpha を無効化" });
    const betaSwitch = screen.getByRole("switch", { name: "beta を有効化" });

    fireEvent.click(alphaSwitch);

    await waitFor(() => {
      expect(alphaSwitch).toHaveProperty("disabled", true);
      expect(alphaSwitch.closest("li")?.getAttribute("aria-busy")).toBe("true");
    });
    // The other row stays operable.
    expect(betaSwitch).toHaveProperty("disabled", false);
    expect(betaSwitch.closest("li")?.getAttribute("aria-busy")).toBeNull();

    resolveToggle?.();
    await waitFor(() => expect(alphaSwitch).toHaveProperty("disabled", false));
  });

  it("shows the empty state with placement guidance", async () => {
    mockGetJson({ emptySkills: true });
    render(<ExtensionsSettings />);
    expect(
      await screen.findByText(/skills\/<名前>\/SKILL\.md を配置すると/),
    ).toBeTruthy();
  });

  it("shows a retryable error for a failed section", async () => {
    mockGetJson({ skillsFail: true });
    render(<ExtensionsSettings />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("スキル一覧を取得できません");

    // Retry succeeds after the section recovers.
    mockGetJson();
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "alpha を無効化" })).toBeTruthy();
    });
  });

  it("shows a toggle failure inline and keeps the row", async () => {
    sendJson.mockRejectedValueOnce(new Error("移動先に同名の項目が既に存在します"));
    render(<ExtensionsSettings />);
    fireEvent.click(await screen.findByRole("switch", { name: "alpha を無効化" }));

    expect(
      await screen.findByText("移動先に同名の項目が既に存在します"),
    ).toBeTruthy();
    expect(screen.queryByText(/変更を反映するには/)).toBeNull();
  });

  it("disables the restart button with a hint when the host is unavailable", async () => {
    mockFetch(false);
    render(<ExtensionsSettings />);
    fireEvent.click(await screen.findByRole("switch", { name: "alpha を無効化" }));

    const restart = await screen.findByRole("button", {
      name: "OpenCode を再起動",
    });
    await waitFor(() => expect(restart).toHaveProperty("disabled", true));
    expect(
      screen.getByText(/トレイホスト（start-webui\.bat）経由で再起動する/),
    ).toBeTruthy();
  });

  it("restarts OpenCode, then clears the banner and reloads all sections", async () => {
    render(<ExtensionsSettings />);
    fireEvent.click(await screen.findByRole("switch", { name: "alpha を無効化" }));

    const restart = await screen.findByRole("button", {
      name: "OpenCode を再起動",
    });
    const skillLoadsBefore = getJson.mock.calls.filter(
      ([p]) => p === "/api/extensions/skills",
    ).length;

    fireEvent.click(restart);

    await waitFor(
      () => {
        expect(
          screen.queryByText("変更を反映するには OpenCode の再起動が必要です。"),
        ).toBeNull();
      },
      { timeout: 5000 },
    );
    // All three sections were reloaded after the restart completed.
    const skillLoadsAfter = getJson.mock.calls.filter(
      ([p]) => p === "/api/extensions/skills",
    ).length;
    expect(skillLoadsAfter).toBe(skillLoadsBefore + 1);
  }, 10000);
});
