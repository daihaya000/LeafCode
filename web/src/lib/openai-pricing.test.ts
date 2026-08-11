import { describe, expect, it } from "vitest";
import { estimateOpenAIApiCost, lookupModelPricing } from "./openai-pricing";

describe("estimateOpenAIApiCost", () => {
  it("prices uncached, cached, cache-write, and reasoning tokens separately", () => {
    expect(
      estimateOpenAIApiCost({
        providerID: "openai",
        modelID: "gpt-5.6-luna",
        tokens: {
          input: 3_000_000,
          output: 100_000,
          reasoning: 50_000,
          cache: { read: 2_000_000, write: 100_000 },
        },
      }),
    ).toBeCloseTo(0.425, 12);
  });

  it("uses the Fast price table for a -fast model id", () => {
    expect(
      estimateOpenAIApiCost({
        providerID: "openai",
        modelID: "gpt-5.6-luna-fast",
        tokens: { input: 1_000_000, output: 100_000, reasoning: 0 },
      }),
    ).toBeCloseTo(0.64, 12);
  });

  it("returns null for unknown providers/models and zero usage", () => {
    const tokens = { input: 1, output: 1, reasoning: 1 };
    expect(
      estimateOpenAIApiCost({ providerID: "anthropic", modelID: "gpt-5.6-luna", tokens }),
    ).toBeNull();
    expect(
      estimateOpenAIApiCost({ providerID: "openai", modelID: "not-in-catalog", tokens }),
    ).toBeNull();
    expect(
      estimateOpenAIApiCost({
        providerID: "openai",
        modelID: "gpt-5.6-luna",
        tokens: { input: 0, output: 0, reasoning: 0 },
      }),
    ).toBeNull();
  });

  it("does not produce a negative uncached input component", () => {
    expect(
      estimateOpenAIApiCost({
        providerID: "openai",
        modelID: "gpt-5.6-luna",
        tokens: {
          input: 100,
          output: 0,
          reasoning: 0,
          cache: { read: 1_000, write: 0 },
        },
      }),
    ).toBeCloseTo(0.00002, 12);
  });

  it("uses a manual price for a model outside the built-in catalog", () => {
    expect(
      estimateOpenAIApiCost(
        {
          providerID: "anthropic",
          modelID: "claude-sonnet-5",
          tokens: { input: 1_000_000, output: 100_000, reasoning: 0 },
        },
        { input: 3, output: 15 },
      ),
    ).toBeCloseTo(4.5, 12);
  });

  it("prefers a manual price over the built-in catalog", () => {
    expect(
      estimateOpenAIApiCost(
        {
          providerID: "openai",
          modelID: "gpt-5.6-luna",
          tokens: { input: 1_000_000, output: 100_000, reasoning: 0 },
        },
        { input: 1, output: 5 },
      ),
    ).toBeCloseTo(1.5, 12);
  });

  it("returns null when a manual price is absent and the model is unknown", () => {
    expect(
      estimateOpenAIApiCost(
        {
          providerID: "anthropic",
          modelID: "claude-sonnet-5",
          tokens: { input: 1_000_000, output: 100_000, reasoning: 0 },
        },
        null,
      ),
    ).toBeNull();
  });
});

describe("lookupModelPricing", () => {
  it("matches tagged model IDs while preferring exact and longer base IDs", () => {
    const pricing = {
      "ollama-cloud::gpt-oss": { input: 1, output: 2 },
      "ollama-cloud::gpt-oss:120b": { input: 3, output: 4 },
    };

    expect(lookupModelPricing(pricing, "ollama-cloud", "gpt-oss:120b")).toEqual({
      input: 3,
      output: 4,
    });
    expect(lookupModelPricing(pricing, "ollama-cloud", "gpt-oss:20b")).toEqual({
      input: 1,
      output: 2,
    });
  });
});
