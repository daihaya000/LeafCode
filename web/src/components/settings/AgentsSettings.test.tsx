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
  },
  {
    name: "a-explorer-openai-gpt-5",
    mode: "subagent",
    description: "Explores the codebase",
    model: { providerID: "openai", modelID: "gpt-5" },
  },
  {
    name: "general",
    mode: "primary",
    description: "Default primary agent",
  },
];

function stubFetch(handler: () => Promise<Response> | Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/opencode/agent")) return handler();
      return new Response("{}", { status: 404 });
    }),
  );
}

describe("AgentsSettings", () => {
  beforeEach(() => {
    stubFetch(() => new Response(JSON.stringify(AGENTS), { status: 200 }));
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
    // Parsed role is the primary label (may appear in table + mobile card).
    expect(screen.getAllByText("lead-programmer").length).toBeGreaterThan(0);
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
    stubFetch(() => new Response(JSON.stringify([]), { status: 200 }));
    render(<AgentsSettings />);

    await screen.findByText("表示できるエージェントがありません。");
  });

  it("keeps the error visible while retrying and recovers", async () => {
    let resolveRetry!: (response: Response) => void;
    const retryResponse = new Promise<Response>((resolve) => {
      resolveRetry = resolve;
    });
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockReturnValueOnce(retryResponse);
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentsSettings />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("エージェントを取得できませんでした");

    const retryButton = screen.getByRole("button", { name: "再試行" });
    fireEvent.click(retryButton);

    expect((retryButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert")).toBe(alert);

    resolveRetry(new Response(JSON.stringify(AGENTS), { status: 200 }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Rank A" })).toBeTruthy();
    });
  });
});
