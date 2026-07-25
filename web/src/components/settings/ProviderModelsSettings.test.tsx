import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderModelsSettings } from "./ProviderModelsSettings";

const { getJson, sendJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  getJson,
  sendJson,
}));

vi.mock("@addons/codexbar", () => ({
  providerIconSrcForOpencodeId: vi.fn(() => "/addons/codexbar/codex.png"),
}));

const PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    enabled: true,
    models: [
      { id: "gpt-5", name: "GPT-5", enabled: true },
      { id: "gpt-4o", name: "GPT-4o", enabled: false },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    enabled: false,
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", enabled: true },
    ],
  },
];

function mockGetJson(overrides?: {
  fail?: boolean;
  empty?: boolean;
}) {
  getJson.mockImplementation((path: string) => {
    if (path === "/api/extensions/provider-models") {
      if (overrides?.fail) {
        return Promise.reject(new Error("一覧を取得できません"));
      }
      if (overrides?.empty) {
        return Promise.resolve({ providers: [] });
      }
      return Promise.resolve({ providers: PROVIDERS });
    }
    return Promise.reject(new Error(`Unexpected getJson: ${path}`));
  });
}

beforeEach(() => {
  getJson.mockReset();
  sendJson.mockReset();
  sendJson.mockResolvedValue({ ok: true });
  mockGetJson();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProviderModelsSettings", () => {
  it("renders providers with status badges and switches", async () => {
    render(<ProviderModelsSettings />);

    expect(
      await screen.findByRole("heading", { name: "プロバイダー/モデル" }),
    ).toBeTruthy();

    // OpenAI is enabled
    const openaiSwitch = await screen.findByRole("switch", {
      name: "OpenAI を無効化",
    });
    expect(openaiSwitch.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("OpenAI")).toBeTruthy();

    // Anthropic is disabled
    const anthropicSwitch = screen.getByRole("switch", {
      name: "Anthropic を有効化",
    });
    expect(anthropicSwitch.getAttribute("aria-checked")).toBe("false");
  });

  it("expands a provider to show its models", async () => {
    render(<ProviderModelsSettings />);

    const expandBtn = await screen.findByRole("button", {
      name: /OpenAI のモデルを展開/,
    });
    expect(expandBtn.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(expandBtn);
    expect(expandBtn.getAttribute("aria-expanded")).toBe("true");

    // Models are now visible
    expect(screen.getByText("GPT-5")).toBeTruthy();
    expect(screen.getByText("GPT-4o")).toBeTruthy();

    // Model switches
    const gpt5Switch = screen.getByRole("switch", {
      name: "GPT-5 を無効化",
    });
    expect(gpt5Switch.getAttribute("aria-checked")).toBe("true");

    const gpt4oSwitch = screen.getByRole("switch", {
      name: "GPT-4o を有効化",
    });
    expect(gpt4oSwitch.getAttribute("aria-checked")).toBe("false");
  });

  it("toggles a provider via PATCH", async () => {
    render(<ProviderModelsSettings />);

    const openaiSwitch = await screen.findByRole("switch", {
      name: "OpenAI を無効化",
    });
    fireEvent.click(openaiSwitch);

    await waitFor(() => expect(sendJson).toHaveBeenCalledTimes(1));
    expect(sendJson).toHaveBeenCalledWith(
      "PATCH",
      "/api/extensions/provider-models/openai",
      { enabled: false },
    );
  });

  it("toggles a model via PATCH with provider::model key", async () => {
    render(<ProviderModelsSettings />);

    const expandBtn = await screen.findByRole("button", {
      name: /OpenAI のモデルを展開/,
    });
    fireEvent.click(expandBtn);

    const gpt5Switch = await screen.findByRole("switch", {
      name: "GPT-5 を無効化",
    });
    fireEvent.click(gpt5Switch);

    await waitFor(() => expect(sendJson).toHaveBeenCalledTimes(1));
    expect(sendJson).toHaveBeenCalledWith(
      "PATCH",
      "/api/extensions/provider-models/openai%3A%3Agpt-5",
      { enabled: false },
    );
  });

  it("disables model switches when the provider is disabled", async () => {
    render(<ProviderModelsSettings />);

    // Expand Anthropic (disabled provider)
    const expandBtn = await screen.findByRole("button", {
      name: /Anthropic のモデルを展開/,
    });
    fireEvent.click(expandBtn);

    const claudeSwitch = await screen.findByRole("switch", {
      name: "Claude Sonnet 4 を無効化",
    });
    // The switch should be disabled because the provider is disabled
    expect(claudeSwitch).toHaveProperty("disabled", true);

    // The model row should be visually muted
    const claudeRow = claudeSwitch.closest("li");
    expect(claudeRow?.className).toContain("opacity-50");
  });

  it("marks only the toggled row as busy", async () => {
    let resolveToggle: (() => void) | undefined;
    sendJson.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveToggle = () => resolve({ ok: true });
        }),
    );

    render(<ProviderModelsSettings />);

    const openaiSwitch = await screen.findByRole("switch", {
      name: "OpenAI を無効化",
    });
    const anthropicSwitch = screen.getByRole("switch", {
      name: "Anthropic を有効化",
    });

    fireEvent.click(openaiSwitch);

    await waitFor(() => {
      expect(openaiSwitch).toHaveProperty("disabled", true);
      expect(openaiSwitch.closest("li")?.getAttribute("aria-busy")).toBe("true");
    });
    // The other row stays operable
    expect(anthropicSwitch).toHaveProperty("disabled", false);
    expect(anthropicSwitch.closest("li")?.getAttribute("aria-busy")).toBeNull();

    resolveToggle?.();
    await waitFor(() => expect(openaiSwitch).toHaveProperty("disabled", false));
  });

  it("shows the empty state when no providers exist", async () => {
    mockGetJson({ empty: true });
    render(<ProviderModelsSettings />);

    expect(
      await screen.findByText("利用可能なプロバイダーがありません"),
    ).toBeTruthy();
  });

  it("shows a retryable error for a failed fetch", async () => {
    mockGetJson({ fail: true });
    render(<ProviderModelsSettings />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("一覧を取得できません");

    // Retry succeeds after recovery
    mockGetJson();
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "OpenAI を無効化" })).toBeTruthy();
    });
  });

  it("shows a toggle failure inline", async () => {
    sendJson.mockRejectedValueOnce(new Error("更新に失敗しました"));
    render(<ProviderModelsSettings />);

    const openaiSwitch = await screen.findByRole("switch", {
      name: "OpenAI を無効化",
    });
    fireEvent.click(openaiSwitch);

    expect(await screen.findByText("更新に失敗しました")).toBeTruthy();
  });

  it("keeps the list mounted (no reload flash) when toggling a provider", async () => {
    render(<ProviderModelsSettings />);

    const expandBtn = await screen.findByRole("button", {
      name: /OpenAI のモデルを展開/,
    });
    fireEvent.click(expandBtn);
    await screen.findByText("GPT-5");

    const openaiSwitch = screen.getByRole("switch", {
      name: "OpenAI を無効化",
    });
    fireEvent.click(openaiSwitch);

    await waitFor(() => expect(sendJson).toHaveBeenCalledTimes(1));

    // The expanded models stay visible (no "読み込み中…" flash).
    expect(screen.getByText("GPT-5")).toBeTruthy();
    expect(screen.queryByText("読み込み中…")).toBeNull();

    // The provider switch flips optimistically.
    await waitFor(() =>
      expect(openaiSwitch.getAttribute("aria-checked")).toBe("false"),
    );
    // The model rows are disabled because the provider is now off.
    const gpt5Switch = screen.getByRole("switch", { name: /GPT-5/ });
    expect(gpt5Switch).toHaveProperty("disabled", true);
  });

  it("optimistically toggles a model without reloading the list", async () => {
    render(<ProviderModelsSettings />);

    const expandBtn = await screen.findByRole("button", {
      name: /OpenAI のモデルを展開/,
    });
    fireEvent.click(expandBtn);

    const gpt4oSwitch = await screen.findByRole("switch", {
      name: "GPT-4o を有効化",
    });
    expect(gpt4oSwitch.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(gpt4oSwitch);
    await waitFor(() => expect(sendJson).toHaveBeenCalledTimes(1));

    // No reload flash.
    expect(screen.queryByText("読み込み中…")).toBeNull();
    // The model switch flips optimistically.
    await waitFor(() =>
      expect(gpt4oSwitch.getAttribute("aria-checked")).toBe("true"),
    );
    // Sibling model remains visible and unchanged.
    expect(screen.getByText("GPT-5")).toBeTruthy();
  });
});
