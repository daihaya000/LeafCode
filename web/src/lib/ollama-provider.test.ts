import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listOllamaModels: vi.fn(),
  upsertProviderEntry: vi.fn(),
}));

vi.mock("./ollama-cli", () => ({ listOllamaModels: h.listOllamaModels }));
vi.mock("./opencode-extensions/provider-models", () => ({
  upsertProviderEntry: h.upsertProviderEntry,
}));

import {
  OLLAMA_PROVIDER_ID,
  isOllamaVisionModel,
  ollamaModelValue,
  ollamaProviderConfig,
  registerOllamaProvider,
} from "./ollama-provider";

beforeEach(() => {
  h.listOllamaModels.mockReset().mockResolvedValue([]);
  h.upsertProviderEntry.mockReset().mockResolvedValue(undefined);
});

describe("isOllamaVisionModel", () => {
  it("detects common vision model families", () => {
    for (const model of [
      "qwen2.5vl:7b",
      "llava:13b",
      "llama3.2-vision:11b",
      "minicpm-v:8b",
      "moondream",
      "gemma3:4b",
    ]) {
      expect(isOllamaVisionModel(model)).toBe(true);
    }
  });

  it("keeps text-only models out", () => {
    for (const model of ["llama3:8b", "qwen2.5-coder:7b", "deepseek-r1:8b", "gemma3:1b"]) {
      expect(isOllamaVisionModel(model)).toBe(false);
    }
  });
});

describe("ollamaProviderConfig", () => {
  it("marks vision models as image capable and keeps the local base URL", () => {
    const config = ollamaProviderConfig(["qwen2.5vl:7b", "llama3:8b"]) as {
      npm: string;
      options: { baseURL: string; apiKey: string };
      models: Record<string, Record<string, unknown>>;
    };
    expect(config.npm).toBe("@ai-sdk/openai-compatible");
    expect(config.options.baseURL).toBe("http://127.0.0.1:11434/v1");
    expect(config.models["qwen2.5vl:7b"]).toMatchObject({
      attachment: true,
      modalities: { input: ["text", "image"] },
    });
    expect(config.models["llama3:8b"].attachment).toBeUndefined();
  });
});

describe("registerOllamaProvider", () => {
  it("writes the detected models into opencode.jsonc", async () => {
    h.listOllamaModels.mockResolvedValue(["qwen2.5vl:7b", "llama3:8b", "qwen2.5vl:7b"]);

    const result = await registerOllamaProvider();

    expect(h.upsertProviderEntry).toHaveBeenCalledTimes(1);
    const [providerID, config] = h.upsertProviderEntry.mock.calls[0] as [
      string,
      { models: Record<string, unknown> },
    ];
    expect(providerID).toBe(OLLAMA_PROVIDER_ID);
    // 重複を除いた一覧が丸ごと反映される。
    expect(Object.keys(config.models)).toEqual(["qwen2.5vl:7b", "llama3:8b"]);
    expect(result.visionModels).toEqual(["qwen2.5vl:7b"]);
  });

  it("fails clearly when no model has been pulled", async () => {
    h.listOllamaModels.mockResolvedValue([]);
    await expect(registerOllamaProvider()).rejects.toThrow("モデルが見つかりません");
    expect(h.upsertProviderEntry).not.toHaveBeenCalled();
  });
});

describe("ollamaModelValue", () => {
  it("builds the providerID::modelID value the vision settings store", () => {
    expect(ollamaModelValue("qwen2.5vl:7b")).toBe("ollama::qwen2.5vl:7b");
  });
});
