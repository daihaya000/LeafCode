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
  providerIconSrcForOpencodeId: vi.fn(() => "/icons/codex.png"),
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
  defaultModel?: string | null;
}) {
  getJson.mockImplementation((path: string) => {
    if (path === "/api/settings/default-model") {
      return Promise.resolve({ value: overrides?.defaultModel ?? null });
    }
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
  localStorage.clear();
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

  it("renders default model settings in provider/model tab content", async () => {
    render(<ProviderModelsSettings />);

    expect(
      await screen.findByRole("heading", { name: "デフォルトモデル" }),
    ).toBeTruthy();
    const trigger = screen.getByRole("button", { name: "デフォルトモデル" });
    fireEvent.click(trigger);
    const listbox = screen.getByRole("listbox", { name: "デフォルトモデル" });
    expect(listbox.parentElement).toBe(document.body);
    expect(listbox.textContent).toContain("OpenAI");
    fireEvent.click(screen.getByRole("option", { name: "GPT-5" }));
    expect(localStorage.getItem("webui:default-model")).toBe("openai::gpt-5");
  });

  it("prefers the server-stored default model over localStorage on load", async () => {
    localStorage.setItem("webui:default-model", "local::model");
    mockGetJson({ defaultModel: "openai::gpt-5" });

    render(<ProviderModelsSettings />);

    await waitFor(() => {
      expect(localStorage.getItem("webui:default-model")).toBe("openai::gpt-5");
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "デフォルトモデル" }),
      ).toHaveProperty("value", "openai::gpt-5");
    });
  });

  it("migrates a localStorage-only default model to the server on load", async () => {
    localStorage.setItem("webui:default-model", "local::model");
    sendJson.mockResolvedValue({ ok: true });

    render(<ProviderModelsSettings />);

    await waitFor(() => {
      expect(sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/settings/default-model",
        { value: "local::model" },
      );
    });
    expect(localStorage.getItem("webui:default-model")).toBe("local::model");
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
    expect(screen.getAllByText("GPT-5").length).toBeGreaterThan(0);
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

  it("registers a new custom provider via POST", async () => {
    render(<ProviderModelsSettings />);

    fireEvent.click(await screen.findByRole("button", { name: "登録" }));
    fireEvent.change(screen.getByLabelText("プロバイダーID"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "Custom AI" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://api.example.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("APIキー環境変数（任意）"), {
      target: { value: "CUSTOM_API_KEY" },
    });
    fireEvent.change(screen.getByLabelText("アイコンURL/パス（任意）"), {
      target: { value: "https://example.com/icon.png" },
    });
    fireEvent.change(screen.getByLabelText("モデル（1行1件: model-id|表示名）"), {
      target: { value: "custom-model|Custom Model" },
    });

    fireEvent.click(screen.getByRole("button", { name: "プロバイダーを登録" }));

    await waitFor(() => expect(sendJson).toHaveBeenCalledWith(
      "POST",
      "/api/extensions/provider-models",
      {
        id: "custom",
        name: "Custom AI",
        baseURL: "https://api.example.com/v1",
        apiKeyEnv: "CUSTOM_API_KEY",
        icon: "https://example.com/icon.png",
        models: [{ id: "custom-model", name: "Custom Model" }],
      },
    ));
    expect(await screen.findByText(/OpenCode の再起動後/)).toBeTruthy();
  });

  it("edits an existing configured provider via PUT", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/default-model") {
        return Promise.resolve({ value: null });
      }
      if (path === "/api/extensions/provider-models") {
        return Promise.resolve({
          providers: [
            {
              id: "custom",
              name: "Custom AI",
              enabled: true,
              editable: true,
              baseURL: "https://old.example.com/v1",
              apiKeyEnv: "OLD_KEY",
              icon: "/icons/old.png",
              models: [{ id: "old-model", name: "Old Model", enabled: true }],
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected getJson: ${path}`));
    });
    render(<ProviderModelsSettings />);

    fireEvent.click(await screen.findByRole("button", { name: "編集" }));
    expect(screen.getByLabelText("プロバイダーID")).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "Custom AI Updated" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://new.example.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("APIキー環境変数（任意）"), {
      target: { value: "NEW_KEY" },
    });
    fireEvent.change(screen.getByLabelText("アイコンURL/パス（任意）"), {
      target: { value: "/icons/new.png" },
    });
    fireEvent.change(screen.getByLabelText("モデル（1行1件: model-id|表示名）"), {
      target: { value: "new-model|New Model" },
    });

    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));

    await waitFor(() => expect(sendJson).toHaveBeenCalledWith(
      "PUT",
      "/api/extensions/provider-models/custom",
      {
        id: "custom",
        name: "Custom AI Updated",
        baseURL: "https://new.example.com/v1",
        apiKeyEnv: "NEW_KEY",
        icon: "/icons/new.png",
        models: [{ id: "new-model", name: "New Model" }],
      },
    ));
  });

  it("shows a delete button only for editable (configured) providers", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/default-model") {
        return Promise.resolve({ value: null });
      }
      if (path === "/api/extensions/provider-models") {
        return Promise.resolve({
          providers: [
            {
              id: "custom",
              name: "Custom AI",
              enabled: true,
              editable: true,
              models: [],
            },
            { id: "openai", name: "OpenAI", enabled: true, models: [] },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected getJson: ${path}`));
    });
    render(<ProviderModelsSettings />);

    await screen.findByRole("switch", { name: "OpenAI を無効化" });
    expect(
      screen.getByRole("button", { name: "Custom AI を削除" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "OpenAI を削除" })).toBeNull();
  });

  it("deletes a configured provider via DELETE after confirmation", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/default-model") {
        return Promise.resolve({ value: null });
      }
      if (path === "/api/extensions/provider-models") {
        return Promise.resolve({
          providers: [
            {
              id: "custom",
              name: "Custom AI",
              enabled: true,
              editable: true,
              models: [],
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected getJson: ${path}`));
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      render(<ProviderModelsSettings />);

      fireEvent.click(
        await screen.findByRole("button", { name: "Custom AI を削除" }),
      );

      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringContaining("Custom AI"),
      );
      await waitFor(() =>
        expect(sendJson).toHaveBeenCalledWith(
          "DELETE",
          "/api/extensions/provider-models/custom",
        ),
      );
      await waitFor(() =>
        expect(screen.queryByText("Custom AI")).toBeNull(),
      );
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("does not send DELETE when provider deletion is cancelled", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/default-model") {
        return Promise.resolve({ value: null });
      }
      if (path === "/api/extensions/provider-models") {
        return Promise.resolve({
          providers: [
            {
              id: "custom",
              name: "Custom AI",
              enabled: true,
              editable: true,
              models: [],
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected getJson: ${path}`));
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      render(<ProviderModelsSettings />);

      fireEvent.click(
        await screen.findByRole("button", { name: "Custom AI を削除" }),
      );

      expect(confirmSpy).toHaveBeenCalled();
      expect(sendJson).not.toHaveBeenCalled();
      expect(screen.getByText("Custom AI")).toBeTruthy();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("edits only the icon of a built-in provider via PATCH", async () => {
    render(<ProviderModelsSettings />);

    await screen.findByRole("switch", { name: "OpenAI を無効化" });
    const iconEditButtons = screen.getAllByRole("button", {
      name: "アイコン編集",
    });
    // OpenAI is the first provider in the mocked list.
    fireEvent.click(iconEditButtons[0]);

    // Built-in providers show a reduced form: no id/name/baseURL/models
    // fields, only the icon input.
    expect(screen.queryByLabelText("プロバイダーID")).toBeNull();
    expect(screen.queryByLabelText("Base URL")).toBeNull();
    expect(
      screen.queryByLabelText("モデル（1行1件: model-id|表示名）"),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText("アイコンURL/パス（任意）"), {
      target: { value: "/icons/custom-openai.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "アイコンを保存" }));

    await waitFor(() => expect(sendJson).toHaveBeenCalledWith(
      "PATCH",
      "/api/extensions/provider-models/openai",
      { icon: "/icons/custom-openai.png" },
    ));
    expect(await screen.findByText("アイコンを更新しました。")).toBeTruthy();
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
    await waitFor(() => expect(screen.getAllByText("GPT-5").length).toBeGreaterThan(0));

    const openaiSwitch = screen.getByRole("switch", {
      name: "OpenAI を無効化",
    });
    fireEvent.click(openaiSwitch);

    await waitFor(() => expect(sendJson).toHaveBeenCalledTimes(1));

    // The expanded models stay visible (no "読み込み中…" flash).
    expect(screen.getAllByText("GPT-5").length).toBeGreaterThan(0);
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
    expect(screen.getAllByText("GPT-5").length).toBeGreaterThan(0);
  });

  it("reorders providers and models with drag and drop", async () => {
    render(<ProviderModelsSettings />);

    const openaiDrag = await screen.findByLabelText("OpenAI をドラッグして並び替え");
    const anthropicDrag = screen.getByLabelText("Anthropic をドラッグして並び替え");
    const dataTransfer = { effectAllowed: "" };

    fireEvent.dragStart(openaiDrag.closest("li")!, { dataTransfer });
    fireEvent.dragOver(anthropicDrag.closest("li")!, { dataTransfer });
    fireEvent.drop(anthropicDrag.closest("li")!, { dataTransfer });

    await waitFor(() => expect(sendJson).toHaveBeenCalledWith(
      "PATCH",
      "/api/extensions/provider-models/order",
      expect.objectContaining({ providerOrder: ["anthropic", "openai"] }),
    ));

    const expandBtn = screen.getByRole("button", {
      name: /OpenAI のモデルを展開/,
    });
    fireEvent.click(expandBtn);
    const gpt5Drag = await screen.findByLabelText("GPT-5 をドラッグして並び替え");
    const gpt4oDrag = screen.getByLabelText("GPT-4o をドラッグして並び替え");

    fireEvent.dragStart(gpt4oDrag.closest("li")!, { dataTransfer });
    fireEvent.dragOver(gpt5Drag.closest("li")!, { dataTransfer });
    fireEvent.drop(gpt5Drag.closest("li")!, { dataTransfer });

    await waitFor(() => expect(sendJson).toHaveBeenCalledWith(
      "PATCH",
      "/api/extensions/provider-models/order",
      expect.objectContaining({
        modelOrder: expect.objectContaining({ openai: ["gpt-4o", "gpt-5"] }),
      }),
    ));
  });
});
