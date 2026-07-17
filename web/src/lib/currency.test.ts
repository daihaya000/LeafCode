import { describe, expect, it } from "vitest";
import {
  DEFAULT_COST_PREFS,
  DEFAULT_USD_JPY_RATE,
  clampUsdJpyRate,
  formatCost,
  sanitizeCostDisplayPrefs,
} from "./currency";

describe("clampUsdJpyRate", () => {
  it("clamps to [1, 1000] and falls back for non-finite", () => {
    expect(clampUsdJpyRate(150)).toBe(150);
    expect(clampUsdJpyRate(0.5)).toBe(1);
    expect(clampUsdJpyRate(5000)).toBe(1000);
    expect(clampUsdJpyRate(Number.NaN)).toBe(DEFAULT_USD_JPY_RATE);
  });
});

describe("sanitizeCostDisplayPrefs", () => {
  it("defaults unknown input to USD + default rate", () => {
    expect(sanitizeCostDisplayPrefs(null)).toEqual(DEFAULT_COST_PREFS);
    expect(sanitizeCostDisplayPrefs("x")).toEqual(DEFAULT_COST_PREFS);
  });

  it("accepts JPY and clamps rate", () => {
    expect(sanitizeCostDisplayPrefs({ currency: "JPY", usdJpyRate: 155.5 })).toEqual({
      currency: "JPY",
      usdJpyRate: 155.5,
    });
    expect(sanitizeCostDisplayPrefs({ currency: "JPY", usdJpyRate: "140" })).toEqual({
      currency: "JPY",
      usdJpyRate: 140,
    });
  });

  it("treats unknown currency as USD", () => {
    expect(sanitizeCostDisplayPrefs({ currency: "EUR", usdJpyRate: 100 })).toEqual({
      currency: "USD",
      usdJpyRate: 100,
    });
  });
});

describe("formatCost", () => {
  it("formats USD", () => {
    expect(formatCost(0.1542)).toBe("cost $0.1542");
    expect(formatCost(0)).toBe("");
  });

  it("formats JPY with USD in parentheses", () => {
    expect(
      formatCost(0.1542, { currency: "JPY", usdJpyRate: 150 }),
    ).toBe("cost ¥23.1（$0.1542）");
    expect(
      formatCost(1, { currency: "JPY", usdJpyRate: 150 }),
    ).toBe("cost ¥150（$1.0000）");
    expect(
      formatCost(0.001, { currency: "JPY", usdJpyRate: 150 }),
    ).toBe("cost ¥0.15（$0.0010）");
  });
});
