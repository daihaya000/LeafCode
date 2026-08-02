import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexBarWidget } from "./CodexBarWidget";

const { getJson } = vi.hoisted(() => ({ getJson: vi.fn() }));

vi.mock("@/lib/client", () => ({ getJson }));
vi.mock("@/lib/addons/state", () => ({ writeAddonEnabled: vi.fn() }));

afterEach(() => {
  cleanup();
});

describe("CodexBarWidget credits", () => {
  beforeEach(() => {
    localStorage.setItem("webui:addon:codexbar:collapsed", "0");
    localStorage.removeItem("webui:addon:codexbar:providers");
    localStorage.removeItem("webui:plugin:codexbar:collapsed");
    localStorage.removeItem("webui:plugin:codexbar:providers");
    getJson.mockReset();
    getJson.mockImplementation((url: string) => {
      if (url.endsWith("/tokens")) {
        return Promise.resolve({ available: false });
      }
      return Promise.resolve({
        available: true,
        reason: null,
        schema: "codexbar.usage-snapshot/v1",
        generatedAt: null,
        subscriptionTotalMonthlyUsd: 100,
        providers: [
          {
            id: "claude",
            opencodeId: "anthropic",
            plan: "Max",
            planMonthlyUsd: 100,
            usedPercent: null,
            limited: false,
            maxed: false,
            resetsAt: null,
            updatedAt: null,
            error: null,
            windows: [],
            credits: {
              title: "利用クレジット",
              used: 12.5,
              limit: 300,
              balance: 287.5,
            },
          },
        ],
      });
    });
  });

  it("minimizes providers by default and expands to show credit usage", async () => {
    render(<CodexBarWidget />);

    fireEvent.click(await screen.findByRole("button", { name: "Claude を展開" }));
    expect(await screen.findByText("利用クレジット")).not.toBeNull();
    expect(screen.getByText("$12.50 / $300.00")).not.toBeNull();
    expect(screen.getByText("残高 $287.50")).not.toBeNull();
  });
});

describe("CodexBarWidget error collapse", () => {
  beforeEach(() => {
    localStorage.setItem("webui:addon:codexbar:collapsed", "0");
    localStorage.removeItem("webui:addon:codexbar:providers");
    getJson.mockReset();
    getJson.mockImplementation((url: string) => {
      if (url.endsWith("/tokens")) {
        return Promise.resolve({ available: false });
      }
      return Promise.resolve({
        available: true,
        reason: null,
        schema: "codexbar.usage-snapshot/v1",
        generatedAt: null,
        subscriptionTotalMonthlyUsd: null,
        providers: [
          {
            id: "synthetic",
            opencodeId: "synthetic",
            plan: null,
            planMonthlyUsd: null,
            // CodexBar exports placeholder 0 (not null) when API key is missing.
            usedPercent: 0,
            limited: false,
            maxed: false,
            resetsAt: null,
            updatedAt: null,
            error: "API キーが未設定です",
            windows: [],
            credits: null,
          },
        ],
      });
    });
  });

  it("can collapse and expand an errored provider", async () => {
    const { container } = render(<CodexBarWidget />);

    fireEvent.click(await screen.findByRole("button", { name: "Synthetic を展開" }));
    expect(await screen.findByText("API キーが未設定です")).not.toBeNull();
    expect(screen.getByText("エラー")).not.toBeNull();
    // Must not show placeholder 0% as if usage were healthy.
    expect(container.textContent).not.toMatch(/(?<![0-9])0%(?![0-9])/);
    fireEvent.click(screen.getByRole("button", { name: "Synthetic を最小化" }));
    expect(screen.queryByText("API キーが未設定です")).toBeNull();
    expect(screen.getByText("エラー")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Synthetic を展開" }));
    expect(screen.getByText("API キーが未設定です")).not.toBeNull();
  });

  it("shows error (not 0%) when CodexBar exports usedPercent:0 with API key missing", async () => {
    getJson.mockReset();
    getJson.mockImplementation((url: string) => {
      if (url.endsWith("/tokens")) {
        return Promise.resolve({ available: false });
      }
      // Shape matches live %APPDATA%\\CodexBar\\usage-snapshot.json for synthetic.
      return Promise.resolve({
        available: true,
        reason: null,
        schema: "codexbar.usage-snapshot/v1",
        generatedAt: null,
        subscriptionTotalMonthlyUsd: null,
        providers: [
          {
            id: "synthetic",
            opencodeId: "synthetic",
            plan: null,
            planMonthlyUsd: null,
            usedPercent: 0,
            limited: false,
            maxed: false,
            resetsAt: null,
            updatedAt: null,
            error: "API キーが未設定です",
            windows: [],
            credits: null,
          },
        ],
      });
    });

    render(<CodexBarWidget />);
    const provider = await screen.findByRole("button", { name: "Synthetic を展開" });
    fireEvent.click(provider);
    const row = provider.closest("li");
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("API キーが未設定です");
    expect(row!.textContent).toContain("エラー");
    expect(row!.textContent).not.toMatch(/\b0%\b/);
  });

  it("shows last-good usage instead of error when windows exist", async () => {
    getJson.mockReset();
    getJson.mockImplementation((url: string) => {
      if (url.endsWith("/tokens")) {
        return Promise.resolve({ available: false });
      }
      return Promise.resolve({
        available: true,
        reason: null,
        schema: "codexbar.usage-snapshot/v1",
        generatedAt: null,
        subscriptionTotalMonthlyUsd: 10,
        providers: [
          {
            id: "opencode-go",
            opencodeId: "opencode-go",
            plan: "Go",
            planMonthlyUsd: 10,
            usedPercent: 74,
            limited: false,
            maxed: false,
            resetsAt: null,
            updatedAt: null,
            error: "workspace ID が不明です",
            windows: [
              {
                id: "opencode-go-monthly",
                title: "月間",
                usedPercent: 74,
                resetsAt: null,
                windowMinutes: null,
              },
            ],
            credits: null,
          },
        ],
      });
    });

    const { container } = render(<CodexBarWidget />);
    const openCodeButton = await screen.findByRole("button", { name: "OpenCode を展開" });
    fireEvent.click(openCodeButton);
    expect(await screen.findByText("OpenCode")).not.toBeNull();
    const openCodeRow = openCodeButton.closest("li");
    expect(openCodeRow).not.toBeNull();
    expect(openCodeRow!.textContent).toContain("74%");
    expect(openCodeRow!.textContent).not.toContain("エラー");
    expect(container.textContent).not.toContain("workspace ID が不明です");
  });
});
