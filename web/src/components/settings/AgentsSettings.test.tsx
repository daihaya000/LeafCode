import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsSettings } from "./AgentsSettings";
import type { AgentDto } from "./agent-utils";

const AGENTS: AgentDto[] = [
  {
    name: "b-lead-programmer-ollama-cloud-glm-5-2",
    mode: "subagent",
    description: "Multi-file implementation work",
    model: { providerID: "ollama-cloud", modelID: "glm-5.2" },
    enabled: true,
    toggleable: true,
    scope: "global",
    sourcePath: "~/opencode.jsonc",
  },
  {
    name: "a-explorer-openai-gpt-5",
    mode: "subagent",
    description: "Explores the codebase",
    model: { providerID: "openai", modelID: "gpt-5" },
    enabled: true,
    toggleable: true,
    scope: "project",
    sourcePath: ".opencode/agents/a-explorer-openai-gpt-5.md",
  },
  {
    name: "general",
    mode: "primary",
    description: "Default primary agent",
    enabled: true,
    toggleable: true,
    scope: "builtin",
    sourcePath: null,
  },
];

const HOST_OK = { ok: true, controlUrl: "http://127.0.0.1:1" };

function stubFetch(handler: () => Promise<Response> | Response) {
  const hostResponse = new Response(JSON.stringify(HOST_OK), { status: 200 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/extensions/agents")) return handler();
      if (url.includes("/api/host")) return hostResponse;
      return new Response("{}", { status: 404 });
    }),
  );
}

describe("AgentsSettings", () => {
  beforeEach(() => {
    stubFetch(() => new Response(JSON.stringify({ agents: AGENTS }), { status: 200 }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders grouped agents with rank sections and count", async () => {
    render(<AgentsSettings />);

    await screen.findByRole("heading", { name: "Rank A" });
    expect(screen.getByRole("heading", { name: "Rank B" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "その他のエージェント" }),
    ).toBeTruthy();
    expect(screen.getByText("3 件のエージェント")).toBeTruthy();
    expect(screen.getAllByText("lead-programmer").length).toBeGreaterThan(0);
  });

  it("lists each agent's source path and shows its scope once selected", async () => {
    render(<AgentsSettings />);
    await screen.findByRole("heading", { name: "Rank A" });

    // Rank is already the group heading; it must not also repeat as a
    // per-row badge.
    expect(screen.getAllByText("Rank B")).toHaveLength(1);

    // Source paths are the list rows' secondary label.
    expect(screen.getAllByText("~/opencode.jsonc").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(".opencode/agents/a-explorer-openai-gpt-5.md")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("ビルトイン").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /explorer/ }));
    expect(screen.getByText("プロジェクト")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /lead-programmer/ }));
    expect(screen.getByText("グローバル")).toBeTruthy();
  });

  it("shows the selected agent's enabled state", async () => {
    stubFetch(() =>
      new Response(
        JSON.stringify({
          agents: [
            ...AGENTS,
            {
              name: "legacy",
              mode: "subagent",
              enabled: false,
              toggleable: true,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    render(<AgentsSettings />);
    await screen.findByRole("heading", { name: "Rank A" });

    fireEvent.click(screen.getByRole("button", { name: /legacy/ }));
    expect(screen.getByText("無効")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /explorer/ }));
    expect(screen.getByText("有効")).toBeTruthy();
  });

  it("keeps rank and model visible for a disabled agent", async () => {
    stubFetch(() =>
      new Response(
        JSON.stringify({
          agents: [
            {
              name: "a-critical-architect-anthropic-claude-fable-5",
              mode: "subagent",
              description: "Critical architect",
              model: { providerID: "anthropic", modelID: "claude-fable-5" },
              enabled: false,
              toggleable: true,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    render(<AgentsSettings />);
    await screen.findByRole("heading", { name: "Rank A" });

    expect(
      screen.queryByRole("heading", { name: "その他のエージェント" }),
    ).toBeNull();
    expect(screen.getAllByText("critical-architect").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /critical-architect/ }));
    expect(screen.getAllByText(/claude-fable-5/).length).toBeGreaterThan(0);
    expect(screen.getByText("無効")).toBeTruthy();
  });

  it("filters agents via the search box", async () => {
    render(<AgentsSettings />);
    await screen.findByRole("heading", { name: "Rank A" });

    fireEvent.change(screen.getByLabelText("エージェントを検索"), {
      target: { value: "explorer" },
    });

    expect(screen.getByRole("heading", { name: "Rank A" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Rank B" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "その他のエージェント" }),
    ).toBeNull();
  });

  it("filters by enabled/disabled state", async () => {
    stubFetch(() =>
      new Response(
        JSON.stringify({
          agents: [
            ...AGENTS,
            {
              name: "legacy",
              mode: "subagent",
              enabled: false,
              toggleable: true,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    render(<AgentsSettings />);
    await screen.findByRole("heading", { name: "Rank A" });

    fireEvent.change(screen.getByLabelText("エージェントを検索"), {
      target: { value: "無効" },
    });

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Rank A" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Rank B" })).toBeNull();
    });
    expect(screen.getAllByText("legacy").length).toBeGreaterThan(0);
  });

  it("shows a no-match message when the query matches nothing", async () => {
    render(<AgentsSettings />);
    await screen.findByRole("heading", { name: "Rank A" });

    fireEvent.change(screen.getByLabelText("エージェントを検索"), {
      target: { value: "zzz" },
    });

    expect(
      screen.getByText("「zzz」に一致するエージェントはありません。"),
    ).toBeTruthy();
  });

  it("shows an empty message when there are no agents", async () => {
    stubFetch(() => new Response(JSON.stringify({ agents: [] }), { status: 200 }));
    render(<AgentsSettings />);

    await screen.findByText("表示できるエージェントがありません。");
  });

  it("toggles an agent and shows restart banner", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/extensions/agents")) {
        return new Response(JSON.stringify({ agents: AGENTS }), { status: 200 });
      }
      if (url.includes("/api/extensions/agents/")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/api/host")) {
        return new Response(JSON.stringify(HOST_OK), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentsSettings />);
    await screen.findByRole("heading", { name: "Rank A" });

    // Click the per-agent switch for the explorer row, not the provider switch.
    // Desktop table and mobile cards each render one switch per agent.
    fireEvent.click(
      screen.getAllByRole("switch", { name: /a-explorer-openai-gpt-5/ })[0],
    );

    await waitFor(() => {
      expect(screen.getByText("OpenCode を再起動")).toBeTruthy();
    });

    const patchCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/api/extensions/agents/"),
    );
    expect(patchCall).toBeTruthy();
  });

  it("bulk toggles all agents of a provider via by-provider endpoint", async () => {
    const openaiPatch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, count: 1 }), { status: 200 }),
    );
    let lastProviderBody: unknown;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/extensions/agents/by-provider")) {
          lastProviderBody = init?.body
            ? JSON.parse(String(init.body))
            : undefined;
          return openaiPatch();
        }
        if (url.includes("/api/extensions/agents")) {
          return new Response(JSON.stringify({ agents: AGENTS }), { status: 200 });
        }
        if (url.includes("/api/host")) {
          return new Response(JSON.stringify(HOST_OK), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentsSettings />);
    await screen.findByRole("heading", { name: "Rank A" });

    expect(
      screen.getByRole("heading", { name: "提供元ごとの一括操作" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("switch", { name: /openai の全エージェント/ }),
    );

    await waitFor(() => {
      expect(openaiPatch).toHaveBeenCalled();
    });
    expect(lastProviderBody).toEqual({ providerID: "openai", enabled: false });

    await waitFor(() => {
      expect(screen.getByText("OpenCode を再起動")).toBeTruthy();
    });
  });

  it("locks every agent switch while one toggle request is pending", async () => {
    let resolvePatch!: (response: Response) => void;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/extensions/agents/") && !url.endsWith("/agents")) {
        return new Promise<Response>((resolve) => {
          resolvePatch = resolve;
        });
      }
      if (url.includes("/api/extensions/agents")) {
        return new Response(JSON.stringify({ agents: AGENTS }), { status: 200 });
      }
      if (url.includes("/api/host")) {
        return new Response(JSON.stringify(HOST_OK), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentsSettings />);
    await screen.findByRole("heading", { name: "Rank A" });
    const switches = screen.getAllByRole("switch") as HTMLButtonElement[];
    fireEvent.click(
      screen.getAllByRole("switch", { name: /a-explorer-openai-gpt-5/ })[0],
    );

    await waitFor(() => {
      expect(switches.every((button) => button.disabled)).toBe(true);
    });
    resolvePatch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await waitFor(() => expect(switches.every((button) => !button.disabled)).toBe(true));
  });

  it("keeps the error visible while retrying and recovers", async () => {
    let resolveRetry!: (response: Response) => void;
    const retryResponse = new Promise<Response>((resolve) => {
      resolveRetry = resolve;
    });
    let agentsCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/host")) {
        return new Response(JSON.stringify(HOST_OK), { status: 200 });
      }
      if (url.includes("/api/extensions/agents")) {
        agentsCallCount += 1;
        if (agentsCallCount === 1) {
          return new Response("boom", { status: 500 });
        }
        return retryResponse;
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentsSettings />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("エージェントを取得できませんでした");

    const retryButton = screen.getByRole("button", { name: "再試行" });
    fireEvent.click(retryButton);

    expect((retryButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert")).toBe(alert);

    resolveRetry(new Response(JSON.stringify({ agents: AGENTS }), { status: 200 }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Rank A" })).toBeTruthy();
    });
  });
});
