import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listOllamaModels: vi.fn(),
  fetchOllamaModelCapabilities: vi.fn(),
  upsertProviderEntry: vi.fn(),
}));

vi.mock("./ollama-cli", () => ({
  listOllamaModels: h.listOllamaModels,
  fetchOllamaModelCapabilities: h.fetchOllamaModelCapabilities,
}));
vi.mock("./opencode-extensions/provider-models", () => ({
  upsertProviderEntry: h.upsertProviderEntry,
}));

import {
  OLLAMA_PROVIDER_ID,
  isOllamaVisionModel,
  ollamaModelValue,
  ollamaProviderConfig,
  registerOllamaProvider,
  resolveOllamaModelEntries,
} from "./ollama-provider";

beforeEach(() => {
  h.listOllamaModels.mockReset().mockResolvedValue([]);
  h.fetchOllamaModelCapabilities.mockReset().mockResolvedValue(null);
  h.upsertProviderEntry.mockReset().mockResolvedValue(undefined);
});

describe("isOllamaVisionModel (fallback heuristic)", () => {
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

describe("resolveOllamaModelEntries", () => {
  it("uses the capabilities Ollama reports", async () => {
    h.fetchOllamaModelCapabilities.mockImplementation(async (model: string) =>
      model === "qwen2.5vl:7b"
        ? { vision: true, tools: false }
        : { vision: false, tools: true },
    );

    await expect(
      resolveOllamaModelEntries(["qwen2.5vl:7b", "dolphin3:8b"]),
    ).resolves.toEqual([
      { id: "qwen2.5vl:7b", vision: true, tools: false },
      { id: "dolphin3:8b", vision: false, tools: true },
    ]);
  });

  it("falls back to the name heuristic when Ollama cannot be queried", async () => {
    h.fetchOllamaModelCapabilities.mockResolvedValue(null);

    await expect(
      resolveOllamaModelEntries(["qwen2.5vl:7b", "llama3:8b"]),
    ).resolves.toEqual([
      { id: "qwen2.5vl:7b", vision: true, tools: true },
      { id: "llama3:8b", vision: false, tools: true },
    ]);
  });
});

describe("ollamaProviderConfig", () => {
  it("marks vision models as image capable and keeps the local base URL", () => {
    const config = ollamaProviderConfig([
      { id: "qwen2.5vl:7b", vision: true, tools: false },
      { id: "llama3:8b", vision: false, tools: true },
    ]) as {
      npm: string;
      options: { baseURL: string; apiKey: string };
      models: Record<string, Record<string, unknown>>;
    };
    expect(config.npm).toBe("@ai-sdk/openai-compatible");
    expect(config.options.baseURL).toBe("http://127.0.0.1:11434/v1");
    // OpenCode はこの2フィールドから capabilities.attachment / input.image を作る。
    expect(config.models["qwen2.5vl:7b"]).toEqual({
      name: "qwen2.5vl:7b",
      tool_call: false,
      attachment: true,
      modalities: { input: ["text", "image"], output: ["text"] },
    });
    expect(config.models["llama3:8b"]).toEqual({
      name: "llama3:8b",
      tool_call: true,
    });
  });
});

describe("registerOllamaProvider", () => {
  it("writes the detected models into opencode.jsonc", async () => {
    h.listOllamaModels.mockResolvedValue(["qwen2.5vl:7b", "llama3:8b", "qwen2.5vl:7b"]);
    h.fetchOllamaModelCapabilities.mockImplementation(async (model: string) => ({
      vision: model === "qwen2.5vl:7b",
      tools: true,
    }));

    const result = await registerOllamaProvider();

    expect(h.upsertProviderEntry).toHaveBeenCalledTimes(1);
    const [providerID, config] = h.upsertProviderEntry.mock.calls[0] as [
      string,
      { models: Record<string, Record<string, unknown>> },
    ];
    expect(providerID).toBe(OLLAMA_PROVIDER_ID);
    // 重複を除いた一覧が丸ごと反映される。
    expect(Object.keys(config.models)).toEqual(["qwen2.5vl:7b", "llama3:8b"]);
    expect(config.models["qwen2.5vl:7b"].attachment).toBe(true);
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
