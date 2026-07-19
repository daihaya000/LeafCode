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

  it("returns low then high when both are declared and enabled", () => {
    expect(
      getIntelligenceVariants({
        name: "GPT-4",
        variants: { high: {}, low: {} },
      }),
    ).toEqual(["low", "high"]);
  });

  it("returns model-declared effort keys in preferred order", () => {
    expect(
      getIntelligenceVariants({
        name: "GPT-5.6 Sol",
        variants: {
          xhigh: {},
          none: {},
          high: {},
          medium: {},
          low: {},
        },
      }),
    ).toEqual(["none", "low", "medium", "high", "xhigh"]);
  });

  it("excludes variants with disabled: true", () => {
    expect(
      getIntelligenceVariants({
        name: "GPT-4",
        variants: { high: { disabled: true }, low: {}, medium: {} },
      }),
    ).toEqual(["low", "medium"]);
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
        variants: { high: {}, turbo: {}, low: {}, medium: {} },
      }),
    ).toEqual(["low", "medium", "high"]);
  });

  it("keeps preferred order regardless of input key order", () => {
    expect(
      getIntelligenceVariants({
        name: "GPT-4",
        variants: { low: {}, high: {} },
      }),
    ).toEqual(["low", "high"]);
  });
});

describe("isIntelligenceVariant", () => {
  it("returns true for known effort keys", () => {
    expect(isIntelligenceVariant("none")).toBe(true);
    expect(isIntelligenceVariant("minimal")).toBe(true);
    expect(isIntelligenceVariant("low")).toBe(true);
    expect(isIntelligenceVariant("medium")).toBe(true);
    expect(isIntelligenceVariant("high")).toBe(true);
    expect(isIntelligenceVariant("xhigh")).toBe(true);
    expect(isIntelligenceVariant("max")).toBe(true);
    expect(isIntelligenceVariant("thinking")).toBe(true);
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
