import { describe, expect, it } from "vitest";
import {
  modelIntelligenceScore,
  normalizeProviderBucket,
  providerSortKey,
  sortModelOptions,
  type ModelOption,
} from "./model-options";

describe("normalizeProviderBucket", () => {
  it("maps known aliases onto the five UI buckets", () => {
    expect(normalizeProviderBucket("openai")).toBe("openai");
    expect(normalizeProviderBucket("anthropic")).toBe("anthropic");
    expect(normalizeProviderBucket("ollama-cloud")).toBe("ollama");
    expect(normalizeProviderBucket("opencode-go")).toBe("opencode");
    expect(normalizeProviderBucket("cursor-acp")).toBe("cursor");
  });
});

describe("providerSortKey", () => {
  it("orders OpenAI > Anthropic > Ollama > OpenCode > Cursor", () => {
    const keys = [
      "cursor-acp",
      "opencode-go",
      "ollama-cloud",
      "anthropic",
      "openai",
    ].map(providerSortKey);
    expect(keys).toEqual([4, 3, 2, 1, 0]);
  });

  it("puts unknown providers after the known five", () => {
    expect(providerSortKey("xai")).toBeGreaterThan(providerSortKey("cursor"));
  });
});

describe("modelIntelligenceScore", () => {
  it("ranks OpenAI models smartest-first", () => {
    const order = [
      "gpt-5.6-sol",
      "gpt-5.5",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ];
    const scores = order.map(modelIntelligenceScore);
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i + 1]);
    }
  });

  it("ranks Anthropic models smartest-first", () => {
    const order = [
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ];
    const scores = order.map(modelIntelligenceScore);
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i + 1]);
    }
  });

  it("ranks Ollama / OpenCode cloud models smartest-first", () => {
    const order = [
      "deepseek-v4-pro",
      "glm-5.2",
      "kimi-k2.7-code",
      "deepseek-v4-flash",
    ];
    const scores = order.map(modelIntelligenceScore);
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i + 1]);
    }
  });
});

describe("sortModelOptions", () => {
  it("orders providers then models smartest-first", () => {
    const input: ModelOption[] = [
      { value: "cursor-acp::auto", label: "Auto", group: "Cursor" },
      {
        value: "ollama-cloud::deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
        group: "Ollama Cloud",
      },
      {
        value: "openai::gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        group: "OpenAI",
      },
      {
        value: "anthropic::claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        group: "Anthropic",
      },
      {
        value: "opencode-go::glm-5.2",
        label: "GLM 5.2",
        group: "OpenCode Go",
      },
      {
        value: "openai::gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        group: "OpenAI",
      },
      {
        value: "anthropic::claude-fable-5",
        label: "Claude Fable 5",
        group: "Anthropic",
      },
      {
        value: "ollama-cloud::deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        group: "Ollama Cloud",
      },
    ];

    const sorted = sortModelOptions(input).map((o) => o.value);
    expect(sorted).toEqual([
      "openai::gpt-5.6-sol",
      "openai::gpt-5.6-luna",
      "anthropic::claude-fable-5",
      "anthropic::claude-haiku-4-5",
      "ollama-cloud::deepseek-v4-pro",
      "ollama-cloud::deepseek-v4-flash",
      "opencode-go::glm-5.2",
      "cursor-acp::auto",
    ]);
  });

  it("does not mutate the input array", () => {
    const input: ModelOption[] = [
      { value: "b::m", label: "B", group: "B" },
      { value: "openai::gpt-5.5", label: "GPT-5.5", group: "OpenAI" },
    ];
    const copy = [...input];
    sortModelOptions(input);
    expect(input).toEqual(copy);
  });
});
