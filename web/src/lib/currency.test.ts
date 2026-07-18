import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  COST_DISPLAY_EVENT,
  DEFAULT_COST_PREFS,
  DEFAULT_USD_JPY_RATE,
  clampUsdJpyRate,
  formatCost,
  formatCostValue,
  sanitizeCostDisplayPrefs,
  useCostDisplayPrefs,
  writeCostDisplayPrefs,
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

describe("formatCostValue", () => {
  it("returns the bare amount (no 'cost ' label)", () => {
    expect(formatCostValue(0.1542)).toBe("$0.1542");
    expect(formatCostValue(0)).toBe("");
    expect(
      formatCostValue(0.1542, { currency: "JPY", usdJpyRate: 150 }),
    ).toBe("¥23.1（$0.1542）");
  });

  it("formatCost is formatCostValue prefixed with 'cost '", () => {
    expect(formatCost(2.5)).toBe(`cost ${formatCostValue(2.5)}`);
  });
});

describe("useCostDisplayPrefs", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("reads prefs on mount and updates on COST_DISPLAY_EVENT", () => {
    const { result } = renderHook(() => useCostDisplayPrefs());
    expect(result.current).toEqual(DEFAULT_COST_PREFS);

    act(() => {
      writeCostDisplayPrefs({ currency: "JPY", usdJpyRate: 130 });
    });
    expect(result.current).toEqual({ currency: "JPY", usdJpyRate: 130 });
  });

  it("ignores malformed event details", () => {
    const { result } = renderHook(() => useCostDisplayPrefs());
    act(() => {
      window.dispatchEvent(
        new CustomEvent(COST_DISPLAY_EVENT, { detail: { currency: "EUR" } }),
      );
    });
    expect(result.current).toEqual(DEFAULT_COST_PREFS);
  });
});
