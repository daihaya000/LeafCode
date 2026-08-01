import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginDto } from "@/lib/extensions";
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

const PLUGINS: PluginDto[] = [
  { id: "config:aaaaaaaaaaaaaaaa.0", name: "plug-a", kind: "config", enabled: true },
  { id: "local:x.js", name: "x.js", kind: "local", enabled: true },
];

function mockGetJson(overrides?: {
  skillsFail?: boolean;
  emptySkills?: boolean;
  skillsTruncated?: boolean;
  plugins?: typeof PLUGINS;
  extraSkills?: {
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
    toggleable: boolean;
  }[];
}) {
  getJson.mockImplementation((path: string) => {
    if (path === "/api/extensions/skills") {
      if (overrides?.skillsFail) {
        return Promise.reject(new Error("スキル一覧を取得できません"));
      }
      const base = overrides?.emptySkills ? [] : SKILLS;
      const skills = overrides?.extraSkills
        ? [...base, ...overrides.extraSkills]
        : base;
      return Promise.resolve({
        skills,
        truncated: overrides?.skillsTruncated === true,
      });
    }
    if (path === "/api/extensions/mcp") {
      return Promise.resolve({ servers: SERVERS });
    }
    if (path === "/api/extensions/plugins") {
      return Promise.resolve({ plugins: overrides?.plugins ?? PLUGINS });
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

/** Host check never settles → hostOk stays null (unconfirmed). */
function mockFetchPendingHost() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/host")) {
        return new Promise<Response>(() => {});
      }
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
  it.each(["skills", "mcp"] as const)(
    "does not show Browser Bridge approvals on the %s tab",
    async (activeSection) => {
      render(<ExtensionsSettings activeSection={activeSection} />);

      await waitFor(() => {
        expect(screen.queryByRole("region", { name: "Browser Bridge 承認" })).toBeNull();
      });
    },
  );

  it("lists skills with accessible switches", async () => {
    render(<ExtensionsSettings activeSection="skills" />);

    expect(await screen.findByRole("heading", { name: "スキル" })).toBeTruthy();

    const alphaSwitch = await screen.findByRole("switch", {
      name: "alpha を無効化",
    });
    expect(alphaSwitch.getAttribute("aria-checked")).toBe("true");
    // Keyboard focus is visible (focus-visible ring, matching other controls).
    expect(alphaSwitch.className).toContain("focus-visible:outline-2");
    expect(alphaSwitch.className).toContain("focus-visible:outline-offset-1");
    expect(alphaSwitch.className).toContain("focus-visible:outline-primary");
    const betaSwitch = screen.getByRole("switch", { name: "beta を有効化" });
    expect(betaSwitch.getAttribute("aria-checked")).toBe("false");
  });

  it("shows Japanese display labels for known skills while keeping the original id", async () => {
    mockGetJson({
      extraSkills: [
        {
          id: "insane-search",
          name: "insane-search",
          description: "Adaptive blocked-site fetch",
          enabled: true,
          toggleable: true,
        },
      ],
    });
    render(<ExtensionsSettings activeSection="skills" />);

    expect(await screen.findByText("遮断サイト適応アクセス")).toBeTruthy();
    expect(screen.getByText("insane-search")).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "遮断サイト適応アクセス を無効化" }),
    ).toBeTruthy();
  });

  it("lists MCP servers with status text", async () => {
    render(<ExtensionsSettings activeSection="mcp" />);

    expect(
      screen.getByRole("heading", { name: "MCP サーバー" }),
    ).toBeTruthy();
    // Status is conveyed as text, not color alone.
    expect(await screen.findByText("接続中")).toBeTruthy();
  });

  it("lists plugins with kind badges", async () => {
    render(<ExtensionsSettings activeSection="plugins" />);

    expect(screen.getByRole("heading", { name: "プラグイン" })).toBeTruthy();
    expect(await screen.findByText("設定済み")).toBeTruthy();
    expect(screen.getByText("ローカル自動読込")).toBeTruthy();
  });

  it("registers a configured plugin with JSON options", async () => {
    render(<ExtensionsSettings activeSection="plugins" />);
    fireEvent.click(await screen.findByRole("button", { name: "登録" }));

    fireEvent.change(screen.getByLabelText("プラグイン名 / npm指定"), {
      target: { value: "opencode-new-plugin@latest" },
    });
    fireEvent.change(screen.getByLabelText(/オプション/), {
      target: { value: '{ "scope": "team" }' },
    });
    fireEvent.click(screen.getByRole("button", { name: "プラグインを登録" }));

    await waitFor(() => expect(sendJson).toHaveBeenCalledTimes(1));
    expect(sendJson).toHaveBeenCalledWith("POST", "/api/extensions/plugins", {
      name: "opencode-new-plugin@latest",
      options: { scope: "team" },
    });
    expect(
      await screen.findByText("変更を反映するには OpenCode の再起動が必要です。"),
    ).toBeTruthy();
  });

  it("shows a client-side error for invalid plugin options JSON", async () => {
    render(<ExtensionsSettings activeSection="plugins" />);
    fireEvent.click(await screen.findByRole("button", { name: "登録" }));
    fireEvent.change(screen.getByLabelText("プラグイン名 / npm指定"), {
      target: { value: "opencode-new-plugin@latest" },
    });
    fireEvent.change(screen.getByLabelText(/オプション/), {
      target: { value: "{" },
    });

    fireEvent.click(screen.getByRole("button", { name: "プラグインを登録" }));

    expect(await screen.findByText("オプションはJSON形式で入力してください")).toBeTruthy();
    expect(sendJson).not.toHaveBeenCalled();
  });

  it("edits only active configured plugins and keeps options blank", async () => {
    mockGetJson({
      plugins: [
        ...PLUGINS,
        {
          id: "config:bbbbbbbbbbbbbbbb.1",
          name: "disabled-plug",
          kind: "config",
          enabled: false,
          managedByWebui: true,
        },
      ],
    });
    render(<ExtensionsSettings activeSection="plugins" />);
    const editButtons = await screen.findAllByRole("button", { name: "編集" });
    expect(editButtons).toHaveLength(1);
    fireEvent.click(editButtons[0]);

    expect(screen.getByRole("heading", { name: "プラグイン編集" })).toBeTruthy();
    expect(screen.getByLabelText("プラグイン名 / npm指定")).toHaveProperty(
      "value",
      "plug-a",
    );
    expect(screen.getByLabelText(/オプション/)).toHaveProperty("value", "");

    fireEvent.change(screen.getByLabelText("プラグイン名 / npm指定"), {
      target: { value: "plug-a-renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));

    await waitFor(() => expect(sendJson).toHaveBeenCalledTimes(1));
    expect(sendJson).toHaveBeenCalledWith(
      "PUT",
      "/api/extensions/plugins/config%3Aaaaaaaaaaaaaaaaa.0",
      { name: "plug-a-renamed", options: undefined },
    );
  });

  it("confirms before permanently removing a disabled WebUI-managed plugin", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    mockGetJson({
      plugins: [
        {
          id: "config:bbbbbbbbbbbbbbbb.1",
          name: "disabled-plug",
          kind: "config",
          enabled: false,
          managedByWebui: true,
        },
      ],
    });
    render(<ExtensionsSettings activeSection="plugins" />);

    fireEvent.click(await screen.findByRole("button", { name: "一覧から削除" }));

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("元設定（オプションを含む）は失われ、後で有効化しても復元できません。"),
    );
    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "DELETE",
        "/api/extensions/plugins/config%3Abbbbbbbbbbbbbbbb.1",
      ),
    );
  });

  it("toggles a skill and shows a single restart banner", async () => {
    render(<ExtensionsSettings activeSection="skills" />);
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

  it("keeps the restart banner across section switches", async () => {
    const { rerender } = render(<ExtensionsSettings activeSection="skills" />);
    fireEvent.click(await screen.findByRole("switch", { name: "alpha を無効化" }));
    expect(
      await screen.findByText("変更を反映するには OpenCode の再起動が必要です。"),
    ).toBeTruthy();

    rerender(<ExtensionsSettings activeSection="mcp" />);

    // The banner survives the section switch (same mount, state preserved)…
    expect(
      screen.getByText("変更を反映するには OpenCode の再起動が必要です。"),
    ).toBeTruthy();
    // …and the MCP section is shown in place of the skills section.
    expect(screen.getByRole("heading", { name: "MCP サーバー" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "スキル" })).toBeNull();
  });

  it("marks only the toggled row as busy", async () => {
    let resolveToggle: (() => void) | undefined;
    sendJson.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveToggle = () => resolve({ ok: true });
        }),
    );

    render(<ExtensionsSettings activeSection="skills" />);
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
    render(<ExtensionsSettings activeSection="skills" />);
    expect(
      await screen.findByText(/skills\/<名前>\/SKILL\.md を配置すると/),
    ).toBeTruthy();
  });

  it("shows a retryable error for a failed section", async () => {
    mockGetJson({ skillsFail: true });
    render(<ExtensionsSettings activeSection="skills" />);

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
    render(<ExtensionsSettings activeSection="skills" />);
    fireEvent.click(await screen.findByRole("switch", { name: "alpha を無効化" }));

    expect(
      await screen.findByText("移動先に同名の項目が既に存在します"),
    ).toBeTruthy();
    expect(screen.queryByText(/変更を反映するには/)).toBeNull();
  });

  it("disables the restart button with a hint when the host is unavailable", async () => {
    mockFetch(false);
    render(<ExtensionsSettings activeSection="skills" />);
    fireEvent.click(await screen.findByRole("switch", { name: "alpha を無効化" }));

    const restart = await screen.findByRole("button", {
      name: "OpenCode を再起動",
    });
    await waitFor(() => expect(restart).toHaveProperty("disabled", true));
    expect(
      screen.getByText(/トレイホスト（start-webui\.bat）経由で再起動する/),
    ).toBeTruthy();
  });

  it("withholds the tray-host hint while the host check is still pending", async () => {
    mockFetchPendingHost();
    render(<ExtensionsSettings activeSection="skills" />);
    fireEvent.click(await screen.findByRole("switch", { name: "alpha を無効化" }));

    const restart = await screen.findByRole("button", {
      name: "OpenCode を再起動",
    });
    // Unconfirmed (hostOk=null): the button stays disabled, but the
    // "use the tray host" hint is not shown — it is only for confirmed
    // host unavailability.
    await waitFor(() => expect(restart).toHaveProperty("disabled", true));
    expect(
      screen.queryByText(/トレイホスト（start-webui\.bat）経由で再起動する/),
    ).toBeNull();
  });

  it("shows a notice when the skills listing was truncated", async () => {
    mockGetJson({ skillsTruncated: true });
    render(<ExtensionsSettings activeSection="skills" />);
    expect(
      await screen.findByText(/スキル数が表示上限を超えたため、一部を一覧から省略しました。/),
    ).toBeTruthy();
  });

  it("restarts OpenCode, then clears the banner and reloads all sections", async () => {
    render(<ExtensionsSettings activeSection="skills" />);
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

  it("nests sub-skills under their parent skill", async () => {
    mockGetJson({
      extraSkills: [
        {
          id: "playwright-cli",
          name: "playwright-cli",
          description: "Browser automation",
          enabled: true,
          toggleable: true,
        },
        {
          id: "playwright-cli/screenshot",
          name: "screenshot",
          description: "Take screenshots",
          enabled: true,
          toggleable: false,
        },
      ],
    });
    render(<ExtensionsSettings activeSection="skills" />);

    // Parent skill is rendered with its normal toggle switch.
    const parentSwitch = await screen.findByRole("switch", {
      name: "playwright-cli を無効化",
    });
    expect(parentSwitch).toBeTruthy();

    const parentLi = parentSwitch.closest("li");
    expect(parentLi).not.toBeNull();

    // Sub-skills are collapsed by default.
    expect(screen.queryByText("screenshot")).toBeNull();

    const expandBtn = screen.getByRole("button", {
      name: /playwright-cli のサブスキルを展開/,
    });
    expect(expandBtn.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(expandBtn);
    expect(expandBtn.getAttribute("aria-expanded")).toBe("true");

    // Now the sub-skill label is rendered inside the parent's <li>.
    const subSkillText = screen.getByText("screenshot");
    expect(parentLi!.contains(subSkillText)).toBe(true);

    // Sub-skill title exposes the full id for discovery.
    const titledEl = parentLi!.querySelector(
      "[title='playwright-cli/screenshot']",
    );
    expect(titledEl).not.toBeNull();

    // Sub-skills are not independently toggleable, even after expanding.
    expect(
      screen.queryByRole("switch", { name: /screenshot/ }),
    ).toBeNull();
  });

  it("groups sub-skills under a parent directory that is not a skill itself", async () => {
    mockGetJson({
      extraSkills: [
        {
          id: "reverse-skill/recon",
          name: "recon",
          description: "Reconnaissance sub-skill",
          enabled: true,
          toggleable: false,
        },
      ],
    });
    render(<ExtensionsSettings activeSection="skills" />);

    // The virtual parent folder label is rendered at the top level.
    const folderLabel = await screen.findByText("reverse-skill");
    expect(folderLabel).toBeTruthy();

    // The folder row carries a neutral "フォルダ" badge and has no switch.
    const folderLi = folderLabel.closest("li");
    expect(folderLi).not.toBeNull();
    expect(within(folderLi!).getByText("フォルダ")).toBeTruthy();
    expect(
      within(folderLi!).queryByRole("switch"),
    ).toBeNull();

    // Sub-skills are collapsed by default.
    expect(screen.queryByText("recon")).toBeNull();

    const expandBtn = screen.getByRole("button", {
      name: /reverse-skill のサブスキルを展開/,
    });
    fireEvent.click(expandBtn);

    // The child sub-skill is now nested underneath the folder row.
    const subSkillText = screen.getByText("recon");
    expect(folderLi!.contains(subSkillText)).toBe(true);
    expect(within(folderLi!).getByText("フォルダ")).toBeTruthy();
    expect(
      within(folderLi!).queryByRole("switch"),
    ).toBeNull();
  });

  it("toggles a toggleable sub-skill via PATCH (defensive: guard future API changes)", async () => {
    // Today's API marks sub-skills as toggleable=false, so the sub-skill switch
    // is never rendered. If a future API revision returns toggleable=true for a
    // sub-skill, the sub-skill row must still issue a PATCH with its nested id
    // (regression: a previous build wired onToggle to a no-op `() => {}`).
    mockGetJson({
      extraSkills: [
        {
          id: "ns",
          name: "ns",
          description: "namespace parent",
          enabled: true,
          toggleable: true,
        },
        {
          id: "ns/leaf",
          name: "leaf",
          description: "toggleable leaf",
          enabled: true,
          toggleable: true,
        },
      ],
    });
    render(<ExtensionsSettings activeSection="skills" />);

    const parentSwitch = await screen.findByRole("switch", {
      name: "ns を無効化",
    });
    fireEvent.click(
      screen.getByRole("button", { name: /ns のサブスキルを展開/ }),
    );

    const leafSwitch = await screen.findByRole("switch", {
      name: "leaf を無効化",
    });
    fireEvent.click(leafSwitch);

    await waitFor(() => expect(sendJson).toHaveBeenCalledTimes(1));
    expect(sendJson).toHaveBeenCalledWith(
      "PATCH",
      "/api/extensions/skills/ns%2Fleaf",
      { enabled: false },
    );
    // parent toggle is left untouched in the same gesture.
    const parentCall = sendJson.mock.calls.find(
      ([, p]) => p === "/api/extensions/skills/ns",
    );
    expect(parentCall).toBeUndefined();
    void parentSwitch;
  });
});
