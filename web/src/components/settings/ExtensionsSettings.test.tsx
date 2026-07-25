import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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

function mockGetJson(overrides?: {
  skillsFail?: boolean;
  emptySkills?: boolean;
  skillsTruncated?: boolean;
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
  it("lists skills, MCP servers and plugins with accessible switches", async () => {
    render(<ExtensionsSettings />);

    expect(await screen.findByRole("heading", { name: "Skills" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "MCP サーバー" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "プラグイン" })).toBeTruthy();

    const alphaSwitch = screen.getByRole("switch", { name: "alpha を無効化" });
    expect(alphaSwitch.getAttribute("aria-checked")).toBe("true");
    // Keyboard focus is visible (focus-visible ring, matching other controls).
    expect(alphaSwitch.className).toContain("focus-visible:outline-2");
    expect(alphaSwitch.className).toContain("focus-visible:outline-offset-1");
    expect(alphaSwitch.className).toContain("focus-visible:outline-primary");
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

  it("withholds the tray-host hint while the host check is still pending", async () => {
    mockFetchPendingHost();
    render(<ExtensionsSettings />);
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
    render(<ExtensionsSettings />);
    expect(
      await screen.findByText(/スキル数が表示上限を超えたため、一部を一覧から省略しました。/),
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
    render(<ExtensionsSettings />);

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
    render(<ExtensionsSettings />);

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
    render(<ExtensionsSettings />);

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
