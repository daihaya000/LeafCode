import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearUsdJpyQuoteCacheForTests,
  fetchUsdJpyQuote,
  getCachedUsdJpyQuote,
  jstDateKey,
} from "./fx-usd-jpy";

afterEach(() => {
  clearUsdJpyQuoteCacheForTests();
});

describe("jstDateKey", () => {
  it("formats the calendar date in Asia/Tokyo", () => {
    // 2026-07-18T15:30:00Z = 2026-07-19 00:30 JST
    expect(jstDateKey(new Date("2026-07-18T15:30:00.000Z"))).toBe("2026-07-19");
  });
});

describe("fetchUsdJpyQuote", () => {
  it("parses frankfurter latest and caches by JST date", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        amount: 1,
        base: "USD",
        date: "2026-07-17",
        rates: { JPY: 157.32 },
      }),
    });
    const q1 = await fetchUsdJpyQuote(fetchImpl);
    expect(q1).toEqual({
      rate: 157.32,
      asOf: "2026-07-17",
      source: "frankfurter",
    });
    expect(getCachedUsdJpyQuote()?.rate).toBe(157.32);

    const q2 = await fetchUsdJpyQuote(fetchImpl);
    expect(q2.rate).toBe(157.32);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects non-finite or out-of-range rates", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ date: "2026-07-17", rates: { JPY: 0 } }),
    });
    await expect(fetchUsdJpyQuote(fetchImpl)).rejects.toThrow(/rate/i);
  });
});
