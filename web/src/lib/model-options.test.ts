import { describe, expect, it } from "vitest";
import {
  filterEnabledModelOptions,
  formatModelLabel,
  mergeConfiguredModelOptions,
  modelIntelligenceScore,
  normalizeProviderBucket,
  providerSortKey,
  sortModelOptions,
  type ModelOption,
} from "./model-options";

describe("mergeConfiguredModelOptions", () => {
  it("adds configured providers missing from the live connected provider list", () => {
    const options = mergeConfiguredModelOptions(
      [{ value: "cursor-acp::auto", label: "Auto", group: "Cursor" }],
      [{
        id: "commandcode",
        name: "CommandCode",
        models: [{ id: "gpt-5.6-terra", name: "GPT-5.6 Terra" }],
      }],
    );

    expect(options.map((option) => option.value)).toEqual([
      "cursor-acp::auto",
      "commandcode::gpt-5.6-terra",
    ]);
  });

  it("does not add disabled configured providers or models", () => {
    const options = mergeConfiguredModelOptions([], [
      { id: "disabled", name: "Disabled", enabled: false, models: [{ id: "m" }] },
      { id: "commandcode", name: "CommandCode", models: [{ id: "hidden", enabled: false }] },
    ]);

    expect(options).toEqual([]);
  });
});

describe("filterEnabledModelOptions", () => {
  const options: ModelOption[] = [
    { value: "openai::gpt-5.5", label: "GPT-5.5", group: "OpenAI" },
    { value: "openai::gpt-5.6-sol", label: "GPT-5.6 Sol", group: "OpenAI" },
    { value: "anthropic::claude-opus-5", label: "Claude Opus 5", group: "Anthropic" },
    { value: "xai::grok", label: "Grok", group: "xAI" },
  ];

  it("removes disabled providers and models from dropdown options", () => {
    expect(
      filterEnabledModelOptions(options, [
        {
          id: "openai",
          enabled: true,
          models: [
            { id: "gpt-5.5", enabled: false },
            { id: "gpt-5.6-sol", enabled: true },
          ],
        },
        {
          id: "anthropic",
          enabled: false,
          models: [{ id: "claude-opus-5", enabled: true }],
        },
      ]).map((option) => option.value),
    ).toEqual(["openai::gpt-5.6-sol", "xai::grok"]);
  });

  it("keeps all options when provider-model settings are unavailable", () => {
    expect(filterEnabledModelOptions(options, undefined)).toBe(options);
  });
});

describe("formatModelLabel", () => {
  it("strips a trailing (latest) marker from upstream names", () => {
    expect(formatModelLabel("Claude Haiku 4.5 (latest)", "claude-haiku-4-5")).toBe(
      "Claude Haiku 4.5",
    );
    expect(formatModelLabel("Claude Haiku 4.5 (Latest)", "x")).toBe("Claude Haiku 4.5");
    expect(formatModelLabel("Foo ( latest )", "x")).toBe("Foo");
  });

  it("leaves other model names unchanged", () => {
    expect(formatModelLabel("Claude Opus 4.8", "claude-opus-4-8")).toBe(
      "Claude Opus 4.8",
    );
    expect(formatModelLabel("GPT-5.6 Sol", "gpt-5.6-sol")).toBe("GPT-5.6 Sol");
    expect(formatModelLabel("latest-preview", "id")).toBe("latest-preview");
  });

  it("falls back when name is empty", () => {
    expect(formatModelLabel("", "claude-haiku-4-5")).toBe("claude-haiku-4-5");
    expect(formatModelLabel(null, "mid")).toBe("mid");
    expect(formatModelLabel("  (latest)  ", "mid")).toBe("mid");
  });
});

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
  it("ranks OpenAI models Sol → Terra → Luna → 5.5", () => {
    const order = [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
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

  it("ranks Ollama / OpenCode cloud models by coding ability", () => {
    const order = [
      "glm-5.2",
      "deepseek-v4-pro",
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
  it("orders providers then models by preferred / coding ability", () => {
    const input: ModelOption[] = [
      { value: "cursor-acp::auto", label: "Auto", group: "Cursor" },
      {
        value: "ollama-cloud::deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
        group: "Ollama Cloud",
      },
      {
        value: "ollama-cloud::kimi-k2.7-code",
        label: "kimi-k2.7-code",
        group: "Ollama Cloud",
      },
      {
        value: "openai::gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        group: "OpenAI",
      },
      {
        value: "openai::gpt-5.5",
        label: "GPT-5.5",
        group: "OpenAI",
      },
      {
        value: "openai::gpt-5.6-terra",
        label: "GPT-5.6 Terra",
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
      {
        value: "ollama-cloud::glm-5.2",
        label: "GLM-5.2",
        group: "Ollama Cloud",
      },
    ];

    const sorted = sortModelOptions(input).map((o) => o.value);
    expect(sorted).toEqual([
      "openai::gpt-5.6-sol",
      "openai::gpt-5.6-terra",
      "openai::gpt-5.6-luna",
      "openai::gpt-5.5",
      "anthropic::claude-fable-5",
      "anthropic::claude-haiku-4-5",
      "ollama-cloud::glm-5.2",
      "ollama-cloud::deepseek-v4-pro",
      "ollama-cloud::kimi-k2.7-code",
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

  it("applies saved provider and model order before default ranking", () => {
    const input: ModelOption[] = [
      { value: "openai::gpt-5.5", label: "GPT-5.5", group: "OpenAI" },
      { value: "anthropic::claude-opus-5", label: "Claude Opus 5", group: "Anthropic" },
      { value: "openai::gpt-5.6-sol", label: "GPT-5.6 Sol", group: "OpenAI" },
    ];

    expect(
      sortModelOptions(input, {
        providerOrder: ["anthropic", "openai"],
        modelOrder: { openai: ["gpt-5.5", "gpt-5.6-sol"] },
      }).map((option) => option.value),
    ).toEqual([
      "anthropic::claude-opus-5",
      "openai::gpt-5.5",
      "openai::gpt-5.6-sol",
    ]);
  });
});
