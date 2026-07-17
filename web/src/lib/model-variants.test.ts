import { describe, expect, it } from "vitest";
import {
  getIntelligenceVariants,
  isIntelligenceVariant,
} from "./model-variants";

describe("getIntelligenceVariants", () => {
  it("returns [] for undefined", () => {
    expect(getIntelligenceVariants(undefined)).toEqual([]);
  });

  it("returns [] when model has no variants", () => {
    expect(getIntelligenceVariants({ name: "GPT-4" })).toEqual([]);
  });

  it("returns ['high'] when only high is declared and enabled", () => {
    expect(
      getIntelligenceVariants({ name: "GPT-4", variants: { high: {} } }),
    ).toEqual(["high"]);
  });

  it("returns ['low'] when only low is declared and enabled", () => {
    expect(
      getIntelligenceVariants({ name: "GPT-4", variants: { low: {} } }),
    ).toEqual(["low"]);
  });

  it("returns ['high', 'low'] when both are declared and enabled", () => {
    expect(
      getIntelligenceVariants({
        name: "GPT-4",
        variants: { high: {}, low: {} },
      }),
    ).toEqual(["high", "low"]);
  });

  it("excludes variants with disabled: true", () => {
    expect(
      getIntelligenceVariants({
        name: "GPT-4",
        variants: { high: { disabled: true }, low: {} },
      }),
    ).toEqual(["low"]);
  });

  it("returns [] when all variants are disabled", () => {
    expect(
      getIntelligenceVariants({
        name: "GPT-4",
        variants: { high: { disabled: true }, low: { disabled: true } },
      }),
    ).toEqual([]);
  });

  it("ignores unknown variant keys", () => {
    expect(
      getIntelligenceVariants({
        name: "GPT-4",
        variants: { high: {}, turbo: {}, low: {} },
      }),
    ).toEqual(["high", "low"]);
  });

  it("keeps fixed ['high','low'] order regardless of input key order", () => {
    expect(
      getIntelligenceVariants({
        name: "GPT-4",
        variants: { low: {}, high: {} },
      }),
    ).toEqual(["high", "low"]);
  });
});

describe("isIntelligenceVariant", () => {
  it("returns true for 'high'", () => {
    expect(isIntelligenceVariant("high")).toBe(true);
  });

  it("returns true for 'low'", () => {
    expect(isIntelligenceVariant("low")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isIntelligenceVariant("")).toBe(false);
  });

  it("returns false for 'turbo'", () => {
    expect(isIntelligenceVariant("turbo")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isIntelligenceVariant(undefined)).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isIntelligenceVariant(42)).toBe(false);
  });
});