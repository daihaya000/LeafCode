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

type TestPricing = {
  input: number;
  cachedInput?: number;
  cacheWrite?: number;
  output: number;
};

type TestProvider = {
  id: string;
  name: string;
  enabled: boolean;
  models: {
    id: string;
    name: string;
    enabled: boolean;
    pricing?: TestPricing;
    variants?: Record<string, { disabled?: boolean } | undefined>;
  }[];
};

const PROVIDERS: TestProvider[] = [
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
  defaultModelEffort?: string | null;
  generationModel?: string | null;
  generationModelEffort?: string | null;
  autoOptimize?: string | null;
  autoShowModel?: string | null;
  providers?: typeof PROVIDERS;
}) {
  getJson.mockImplementation((path: string) => {
    if (path === "/api/settings/default-model") {
      return Promise.resolve({ value: overrides?.defaultModel ?? null });
    }
    if (path === "/api/settings/default-model-effort") {
      return Promise.resolve({ value: overrides?.defaultModelEffort ?? null });
    }
    if (path === "/api/settings/generation-model") {
      return Promise.resolve({ value: overrides?.generationModel ?? null });
    }
    if (path === "/api/settings/generation-model-effort") {
      return Promise.resolve({ value: overrides?.generationModelEffort ?? null });
    }
    if (path === "/api/settings/auto-optimize") {
      return Promise.resolve({ value: overrides?.autoOptimize ?? null });
    }
    if (path === "/api/settings/auto-show-model") {
      return Promise.resolve({ value: overrides?.autoShowModel ?? null });
    }
    if (path === "/api/extensions/provider-models") {
      if (overrides?.fail) {
        return Promise.reject(new Error("一覧を取得できません"));
      }
      if (overrides?.empty) {
        return Promise.resolve({ providers: [] });
      }
      return Promise.resolve({ providers: overrides?.providers ?? PROVIDERS });
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
    const trigger = screen.getByRole("combobox", { name: "デフォルトモデル" });
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
        screen.getByRole("combobox", { name: "デフォルトモデル" }).textContent,
      ).toContain("GPT-5");
    });
  });

  it("persists the default model effort locally and to the server", async () => {
    mockGetJson({ defaultModel: "openai::gpt-5" });
    render(<ProviderModelsSettings />);

    await screen.findByRole("combobox", { name: "デフォルトモデル" });
    const effortTrigger = screen.getByRole("button", {
      name: "デフォルトモデルのEffort",
    });
    fireEvent.click(effortTrigger);
    fireEvent.click(screen.getByRole("option", { name: "high" }));

    await waitFor(() => {
      expect(localStorage.getItem("webui:default-model-effort")).toBe("high");
      expect(sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/settings/default-model-effort",
        { value: "high" },
      );
    });
  });

  it("hydrates the server default model effort into localStorage on load", async () => {
    mockGetJson({ defaultModel: "openai::gpt-5", defaultModelEffort: "medium" });
    render(<ProviderModelsSettings />);

    await waitFor(() => {
      expect(localStorage.getItem("webui:default-model-effort")).toBe("medium");
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "デフォルトモデルのEffort" })
          .textContent,
      ).toContain("medium");
    });
  });

  it("restricts default effort options to the model's declared variants", async () => {
    mockGetJson({
      defaultModel: "openai::gpt-5",
      providers: [
        {
          ...PROVIDERS[0],
          models: [
            {
              ...PROVIDERS[0].models[0],
              variants: { medium: {}, high: {} },
            },
            PROVIDERS[0].models[1],
          ],
        },
        PROVIDERS[1],
      ],
    });
    render(<ProviderModelsSettings />);

    const effortTrigger = await screen.findByRole("button", {
      name: "デフォルトモデルのEffort",
    });
    fireEvent.click(effortTrigger);
    expect(screen.getByRole("option", { name: "high" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "medium" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "xhigh" })).toBeNull();
  });

  it("persists the generation model effort locally and to the server", async () => {
    mockGetJson({ generationModel: "openai::gpt-5" });
    render(<ProviderModelsSettings />);

    await screen.findByRole("combobox", { name: "タイトル / NextAction 生成モデル" });
    const effortTrigger = screen.getByRole("button", {
      name: "生成モデルのEffort",
    });
    fireEvent.click(effortTrigger);
    fireEvent.click(screen.getByRole("option", { name: "low" }));

    await waitFor(() => {
      expect(localStorage.getItem("webui:generation-model-effort")).toBe("low");
      expect(sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/settings/generation-model-effort",
        { value: "low" },
      );
    });
  });

  it("keeps a default model chosen while the initial server read is pending", async () => {
    let releaseServer!: () => void;
    const serverReady = new Promise<void>((resolve) => {
      releaseServer = resolve;
    });
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/default-model") {
        return serverReady.then(() => ({ value: "anthropic::claude-sonnet-4-20250514" }));
      }
      if (path === "/api/extensions/provider-models") {
        return Promise.resolve({ providers: PROVIDERS });
      }
      if (path === "/api/settings/auto-optimize" || path === "/api/settings/auto-show-model") {
        return Promise.resolve({ value: null });
      }
      return Promise.reject(new Error(`Unexpected getJson: ${path}`));
    });

    render(<ProviderModelsSettings />);

    await screen.findByRole("switch", { name: /OpenAI/ });
    const defaultModelTrigger = screen.getByRole("combobox", { name: "デフォルトモデル" });
    fireEvent.click(defaultModelTrigger);
    fireEvent.click(screen.getByRole("option", { name: "GPT-5" }));
    expect(localStorage.getItem("webui:default-model")).toBe("openai::gpt-5");

    releaseServer();
    await waitFor(() =>
      expect(defaultModelTrigger.textContent).toContain("GPT-5"),
    );
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

  it("does not resurrect the old server value when the settings section remounts (e.g. a Settings tab switch) before a Clear PUT lands", async () => {
    let serverValue: string | null = "openai::gpt-5";
    let releasePut!: () => void;
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/default-model") {
        return Promise.resolve({ value: serverValue });
      }
      if (path === "/api/extensions/provider-models") {
        return Promise.resolve({ providers: PROVIDERS });
      }
      if (
        path === "/api/settings/auto-optimize" ||
        path === "/api/settings/auto-show-model"
      ) {
        return Promise.resolve({ value: null });
      }
      return Promise.reject(new Error(`Unexpected getJson: ${path}`));
    });
    sendJson.mockImplementation(
      (_method: string, path: string, body: { value: string | null }) => {
        if (path === "/api/settings/default-model") {
          return new Promise((resolve) => {
            releasePut = () => {
              serverValue = body.value;
              resolve({ ok: true });
            };
          });
        }
        return Promise.resolve({ ok: true });
      },
    );

    const { unmount } = render(<ProviderModelsSettings />);

    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "デフォルトモデル" }).textContent,
      ).toContain("GPT-5");
    });

    fireEvent.click(screen.getByRole("button", { name: "クリア" }));
    expect(localStorage.getItem("webui:default-model")).toBeNull();
    await waitFor(() => expect(typeof releasePut).toBe("function"));

    // Simulate switching Settings tabs away and back before the Clear PUT
    // resolves: unmount and remount re-runs the server-hydration effect.
    unmount();
    render(<ProviderModelsSettings />);
    releasePut();

    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "デフォルトモデル" }).textContent,
      ).not.toContain("GPT-5");
    });
    expect(localStorage.getItem("webui:default-model")).toBeNull();
  });

  it("uses local Auto settings immediately and keeps their defaults", async () => {
    localStorage.setItem("webui:auto-optimize", "intelligence");
    localStorage.setItem("webui:auto-show-model", "1");

    render(<ProviderModelsSettings />);

    expect(
      await screen.findByRole("button", { name: "Auto の最適化" }),
    ).toHaveProperty("value", "intelligence");
    expect(
      screen
        .getByRole("switch", {
          name: "Autoが選んだモデル名を表示 を無効化",
        })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("hydrates server Auto settings into localStorage when no local value exists", async () => {
    mockGetJson({
      autoOptimize: "balanced",
      autoShowModel: "1",
    });

    render(<ProviderModelsSettings />);

    await waitFor(() => {
      expect(localStorage.getItem("webui:auto-optimize")).toBe("balanced");
      expect(localStorage.getItem("webui:auto-show-model")).toBe("1");
    });
    expect(screen.getByRole("button", { name: "Auto の最適化" })).toHaveProperty(
      "value",
      "balanced",
    );
    expect(
      screen
        .getByRole("switch", {
          name: "Autoが選んだモデル名を表示 を無効化",
        })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("persists each Auto setting change locally and to the server", async () => {
    render(<ProviderModelsSettings />);

    fireEvent.click(await screen.findByRole("button", { name: "Auto の最適化" }));
    fireEvent.click(screen.getByRole("option", { name: "知能優先" }));
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Autoが選んだモデル名を表示 を有効化",
      }),
    );

    await waitFor(() => {
      expect(localStorage.getItem("webui:auto-optimize")).toBe("intelligence");
      expect(localStorage.getItem("webui:auto-show-model")).toBe("1");
      expect(sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/settings/auto-optimize",
        { value: "intelligence" },
      );
      expect(sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/settings/auto-show-model",
        { value: "1" },
      );
    });
  });

  it("removes local Auto toggles and sends empty values when turned off", async () => {
    localStorage.setItem("webui:auto-show-model", "1");
    render(<ProviderModelsSettings />);

    fireEvent.click(
      await screen.findByRole("switch", {
        name: "Autoが選んだモデル名を表示 を無効化",
      }),
    );

    await waitFor(() => {
      expect(localStorage.getItem("webui:auto-show-model")).toBeNull();
      expect(sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/settings/auto-show-model",
        { value: "" },
      );
    });
  });

  it("does not let a late server value restore a toggle turned off by the user", async () => {
    localStorage.setItem("webui:auto-show-model", "1");
    let releaseServer: () => void = () => undefined;
    const serverReady = new Promise<void>((resolve) => {
      releaseServer = resolve;
    });
    getJson.mockImplementation((path: string) => {
      if (path === "/api/extensions/provider-models") {
        return Promise.resolve({ providers: PROVIDERS });
      }
      if (path === "/api/settings/default-model") {
        return Promise.resolve({ value: null });
      }
      if (path === "/api/settings/auto-show-model") {
        return serverReady.then(() => ({ value: "1" }));
      }
      if (
        path === "/api/settings/auto-optimize"
      ) {
        return serverReady.then(() => ({ value: null }));
      }
      return Promise.reject(new Error(`Unexpected getJson: ${path}`));
    });

    render(<ProviderModelsSettings />);
    fireEvent.click(
      await screen.findByRole("switch", {
        name: "Autoが選んだモデル名を表示 を無効化",
      }),
    );
    releaseServer();

    await waitFor(() => {
      expect(localStorage.getItem("webui:auto-show-model")).toBeNull();
      expect(
        screen
          .getByRole("switch", {
            name: "Autoが選んだモデル名を表示 を有効化",
          })
          .getAttribute("aria-checked"),
      ).toBe("false");
    });
  });

  it("syncs Auto setting storage events from another tab", async () => {
    render(<ProviderModelsSettings />);

    const mode = await screen.findByRole("button", { name: "Auto の最適化" });
    localStorage.setItem("webui:auto-optimize", "intelligence");
    localStorage.setItem("webui:auto-show-model", "1");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "webui:auto-optimize" }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: "webui:auto-show-model" }),
    );

    await waitFor(() => {
      expect(mode).toHaveProperty("value", "intelligence");
      expect(
        screen.getByRole("switch", {
          name: "Autoが選んだモデル名を表示 を無効化",
        }),
      ).toBeTruthy();
    });
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

  it("shows saved pricing values when the model pricing editor opens", async () => {
    mockGetJson({
      providers: [
        {
          ...PROVIDERS[0],
          models: [
            {
              ...PROVIDERS[0].models[0],
              pricing: {
                input: 0.5026,
                cachedInput: 0.1,
                cacheWrite: 0.7,
                output: 1.5796,
              },
            },
            PROVIDERS[0].models[1],
          ],
        },
        PROVIDERS[1],
      ],
    });
    render(<ProviderModelsSettings />);

    fireEvent.click(
      await screen.findByRole("button", { name: /OpenAI のモデルを展開/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "GPT-5 の価格設定" }),
    );

    expect(screen.getByDisplayValue("0.5026")).toBeTruthy();
    expect(screen.getByDisplayValue("1.5796")).toBeTruthy();
    expect(screen.getByDisplayValue("0.1")).toBeTruthy();
    expect(screen.getByDisplayValue("0.7")).toBeTruthy();
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
    expect(await screen.findByText(/LeafCode の再起動後/)).toBeTruthy();
  });

  it("registers the local Ollama provider through the dedicated API", async () => {
    // 手入力フォームは画像入力対応を表現できないため、専用APIへ委譲する。
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/default-model") {
        return Promise.resolve({ value: null });
      }
      if (path === "/api/extensions/provider-models") {
        return Promise.resolve({ providers: [] });
      }
      return Promise.reject(new Error(`Unexpected getJson: ${path}`));
    });
    sendJson.mockResolvedValue({
      ok: true,
      models: ["qwen2.5vl:7b", "llama3:8b"],
      visionModels: ["qwen2.5vl:7b"],
    });

    render(<ProviderModelsSettings />);

    fireEvent.click(await screen.findByRole("button", { name: "ローカルOllamaを登録" }));

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith("POST", "/api/ollama/register", {}),
    );
    expect(await screen.findByText(/2件のモデルを登録しました（画像対応1件）/)).toBeTruthy();
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

    fireEvent.click(await screen.findByRole("button", { name: "Custom AIを編集" }));
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
    render(<ProviderModelsSettings />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Custom AI を削除" }),
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("alertdialog").querySelector("button")!);

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "DELETE",
        "/api/extensions/provider-models/custom",
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("Custom AI")).toBeNull(),
    );
  });

  it("does not delete a provider twice while the first request is pending", async () => {
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
    let resolveDelete!: (value: unknown) => void;
    sendJson.mockImplementation((method: string, path: string) => {
      if (method === "DELETE" && path === "/api/extensions/provider-models/custom") {
        return new Promise((resolve) => {
          resolveDelete = resolve;
        });
      }
      return Promise.resolve({ ok: true });
    });
    render(<ProviderModelsSettings />);
    const deleteButton = await screen.findByRole("button", {
      name: "Custom AI を削除",
    });

    fireEvent.click(deleteButton);
    fireEvent.click(screen.getByRole("alertdialog").querySelector("button")!);
    await waitFor(() => expect(sendJson).toHaveBeenCalledTimes(1));
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);

    resolveDelete({ ok: true });
    await waitFor(() => expect(screen.queryByText("Custom AI")).toBeNull());
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
    render(<ProviderModelsSettings />);

    const deleteButton = await screen.findByRole("button", { name: "Custom AI を削除" });
    fireEvent.click(deleteButton);
    fireEvent.click(screen.getByRole("alertdialog").querySelectorAll("button")[1]!);

    expect(sendJson).not.toHaveBeenCalled();
    expect(screen.getByText("Custom AI")).toBeTruthy();
  });

  it("focuses the provider deletion confirmation and closes it with Escape", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/default-model") return Promise.resolve({ value: null });
      if (path === "/api/extensions/provider-models") {
        return Promise.resolve({
          providers: [{ id: "custom", name: "Custom AI", enabled: true, editable: true, models: [] }],
        });
      }
      return Promise.reject(new Error(`Unexpected getJson: ${path}`));
    });

    render(<ProviderModelsSettings />);
    const trigger = await screen.findByRole("button", { name: "Custom AI を削除" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("alertdialog");
    const confirm = dialog.querySelector("button") as HTMLElement;
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("edits only the icon of a built-in provider via PATCH", async () => {
    render(<ProviderModelsSettings />);

    await screen.findByRole("switch", { name: "OpenAI を無効化" });
    const iconEditButtons = screen.getAllByRole("button", {
      name: /のアイコンを編集$/,
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

  it("serializes overlapping order saves so the latest drag wins", async () => {
    let resolveFirst!: (value: unknown) => void;
    let orderCalls = 0;
    sendJson.mockImplementation((method: string, path: string) => {
      if (method === "PATCH" && path === "/api/extensions/provider-models/order") {
        orderCalls += 1;
        if (orderCalls === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
      }
      return Promise.resolve({ ok: true });
    });

    render(<ProviderModelsSettings />);
    const openaiDrag = await screen.findByLabelText("OpenAI をドラッグして並び替え");
    const anthropicDrag = screen.getByLabelText("Anthropic をドラッグして並び替え");
    const dataTransfer = { effectAllowed: "" };
    fireEvent.dragStart(openaiDrag.closest("li")!, { dataTransfer });
    fireEvent.dragOver(anthropicDrag.closest("li")!, { dataTransfer });
    fireEvent.drop(anthropicDrag.closest("li")!, { dataTransfer });
    await waitFor(() => expect(orderCalls).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: /OpenAI のモデルを展開/ }));
    const gpt5Drag = await screen.findByLabelText("GPT-5 をドラッグして並び替え");
    const gpt4oDrag = screen.getByLabelText("GPT-4o をドラッグして並び替え");
    fireEvent.dragStart(gpt4oDrag.closest("li")!, { dataTransfer });
    fireEvent.dragOver(gpt5Drag.closest("li")!, { dataTransfer });
    fireEvent.drop(gpt5Drag.closest("li")!, { dataTransfer });

    expect(orderCalls).toBe(1);
    expect(screen.getByRole("status").textContent).toContain("保存中");
    resolveFirst({ ok: true });
    await waitFor(() => expect(orderCalls).toBe(2));
    await waitFor(() => expect(screen.queryByText("並び順を保存中…")).toBeNull());
  });
});
