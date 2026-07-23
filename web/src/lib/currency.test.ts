import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COST_DISPLAY_EVENT,
  DEFAULT_COST_PREFS,
  DEFAULT_USD_JPY_RATE,
  clampUsdJpyRate,
  formatCost,
  formatCostValue,
  readCostDisplayPrefs,
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
  it("defaults unknown input to JPY + auto + default rate", () => {
    expect(sanitizeCostDisplayPrefs(null)).toEqual(DEFAULT_COST_PREFS);
    expect(sanitizeCostDisplayPrefs("x")).toEqual(DEFAULT_COST_PREFS);
    expect(DEFAULT_COST_PREFS).toEqual({
      currency: "JPY",
      rateMode: "auto",
      usdJpyRate: DEFAULT_USD_JPY_RATE,
      showUsdSuffix: false,
    });
  });

  it("treats missing rateMode as manual (legacy prefs)", () => {
    expect(sanitizeCostDisplayPrefs({ currency: "JPY", usdJpyRate: 155.5 })).toEqual({
      currency: "JPY",
      rateMode: "manual",
      usdJpyRate: 155.5,
      showUsdSuffix: false,
    });
  });

  it("accepts explicit auto mode", () => {
    expect(
      sanitizeCostDisplayPrefs({
        currency: "JPY",
        rateMode: "auto",
        usdJpyRate: 140,
      }),
    ).toEqual({
      currency: "JPY",
      rateMode: "auto",
      usdJpyRate: 140,
      showUsdSuffix: false,
    });
  });

  it("keeps USD when explicitly set; maps other currency to JPY", () => {
    expect(sanitizeCostDisplayPrefs({ currency: "USD", usdJpyRate: 100 })).toEqual({
      currency: "USD",
      rateMode: "manual",
      usdJpyRate: 100,
      showUsdSuffix: false,
    });
    expect(sanitizeCostDisplayPrefs({ currency: "EUR", usdJpyRate: 100 })).toEqual({
      currency: "JPY",
      rateMode: "manual",
      usdJpyRate: 100,
      showUsdSuffix: false,
    });
  });

  it("defaults showUsdSuffix to false and only true when explicitly true", () => {
    // Missing / legacy prefs → false
    expect(
      sanitizeCostDisplayPrefs({ currency: "JPY", usdJpyRate: 150 }).showUsdSuffix,
    ).toBe(false);
    // Falsy values → false
    expect(
      sanitizeCostDisplayPrefs({ showUsdSuffix: "true" }).showUsdSuffix,
    ).toBe(false);
    expect(
      sanitizeCostDisplayPrefs({ showUsdSuffix: 1 }).showUsdSuffix,
    ).toBe(false);
    expect(
      sanitizeCostDisplayPrefs({ showUsdSuffix: false }).showUsdSuffix,
    ).toBe(false);
    // Explicit boolean true → true
    expect(
      sanitizeCostDisplayPrefs({ showUsdSuffix: true }).showUsdSuffix,
    ).toBe(true);
  });
});

describe("writeCostDisplayPrefs", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("merges partial update with existing prefs instead of overwriting", () => {
    // Set initial prefs with rateMode="manual"
    writeCostDisplayPrefs({
      currency: "USD",
      rateMode: "manual",
      usdJpyRate: 150,
      showUsdSuffix: true,
    });

    // Partial update: only change currency
    writeCostDisplayPrefs({ currency: "JPY" });

    // rateMode should remain "manual", not reset to "auto"
    const result = readCostDisplayPrefs();
    expect(result.currency).toBe("JPY");
    expect(result.rateMode).toBe("manual");
    expect(result.usdJpyRate).toBe(150);
    expect(result.showUsdSuffix).toBe(true);
  });
});

describe("formatCost", () => {
  it("formats default prefs as JPY without USD suffix", () => {
    expect(formatCost(0.1542)).toBe("cost ¥23.1");
  });

  it("formats USD when prefs say USD", () => {
    expect(
      formatCost(0.1542, {
        currency: "USD",
        rateMode: "manual",
        usdJpyRate: 150,
        showUsdSuffix: false,
      }),
    ).toBe("cost $0.1542");
  });

  it("formats JPY without USD suffix by default", () => {
    expect(
      formatCost(0.1542, {
        currency: "JPY",
        rateMode: "manual",
        usdJpyRate: 150,
        showUsdSuffix: false,
      }),
    ).toBe("cost ¥23.1");
  });

  it("appends USD in parentheses when showUsdSuffix is true", () => {
    expect(
      formatCost(0.1542, {
        currency: "JPY",
        rateMode: "manual",
        usdJpyRate: 150,
        showUsdSuffix: true,
      }),
    ).toBe("cost ¥23.1（$0.1542）");
  });

  it("ignores showUsdSuffix for USD currency", () => {
    expect(
      formatCost(0.1542, {
        currency: "USD",
        rateMode: "manual",
        usdJpyRate: 150,
        showUsdSuffix: true,
      }),
    ).toBe("cost $0.1542");
  });
});

describe("formatCostValue", () => {
  it("returns the bare amount (no 'cost ' label)", () => {
    expect(formatCostValue(0.1542)).toBe("¥23.1");
    expect(formatCostValue(0)).toBe("");
    expect(
      formatCostValue(0.1542, {
        currency: "JPY",
        rateMode: "manual",
        usdJpyRate: 150,
        showUsdSuffix: false,
      }),
    ).toBe("¥23.1");
    expect(
      formatCostValue(0.1542, {
        currency: "JPY",
        rateMode: "manual",
        usdJpyRate: 150,
        showUsdSuffix: true,
      }),
    ).toBe("¥23.1（$0.1542）");
  });

  it("formatCost is formatCostValue prefixed with 'cost '", () => {
    expect(formatCost(2.5)).toBe(`cost ${formatCostValue(2.5)}`);
  });
});

describe("useCostDisplayPrefs", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("reads prefs on mount and updates on COST_DISPLAY_EVENT", () => {
    const { result } = renderHook(() => useCostDisplayPrefs());
    expect(result.current).toEqual(DEFAULT_COST_PREFS);

    act(() => {
      writeCostDisplayPrefs({ currency: "JPY", usdJpyRate: 130 });
    });
    // rateMode remains "auto" (default) because writeCostDisplayPrefs merges
    // with existing prefs; localStorage was empty so DEFAULT_COST_PREFS is base.
    expect(result.current).toEqual({
      currency: "JPY",
      rateMode: "auto",
      usdJpyRate: 130,
      showUsdSuffix: false,
    });
  });

  it("ignores malformed event details", () => {
    const { result } = renderHook(() => useCostDisplayPrefs());
    act(() => {
      window.dispatchEvent(
        new CustomEvent(COST_DISPLAY_EVENT, { detail: null }),
      );
    });
    expect(result.current).toEqual(DEFAULT_COST_PREFS);
  });

  it("fetches daily rate when rateMode is auto and writes it back", async () => {
    writeCostDisplayPrefs({
      currency: "JPY",
      rateMode: "auto",
      usdJpyRate: 150,
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rate: 157.32,
        asOf: "2026-07-17",
        source: "frankfurter",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCostDisplayPrefs());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/fx/usd-jpy",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(result.current.usdJpyRate).toBe(157.32);
    expect(result.current.rateMode).toBe("auto");
  });

  it("does not fetch when rateMode is manual", async () => {
    writeCostDisplayPrefs({
      currency: "JPY",
      rateMode: "manual",
      usdJpyRate: 130,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCostDisplayPrefs());
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.usdJpyRate).toBe(130);
  });
});
