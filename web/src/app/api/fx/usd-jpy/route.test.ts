import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/fx-usd-jpy", async () => {
  const actual = await vi.importActual<typeof import("@/lib/fx-usd-jpy")>(
    "@/lib/fx-usd-jpy",
  );
  return {
    ...actual,
    fetchUsdJpyQuote: vi.fn(),
  };
});

import { GET } from "./route";
import { clearUsdJpyQuoteCacheForTests, fetchUsdJpyQuote } from "@/lib/fx-usd-jpy";

/** Loopback request so the shared API guard authorizes these handler calls. */
function localReq() {
  return new Request("http://127.0.0.1:3000/api", {
    headers: { host: "127.0.0.1:3000" },
  });
}


afterEach(() => {
  clearUsdJpyQuoteCacheForTests();
  vi.mocked(fetchUsdJpyQuote).mockReset();
});

describe("GET /api/fx/usd-jpy", () => {
  it("returns quote on success", async () => {
    vi.mocked(fetchUsdJpyQuote).mockResolvedValue({
      rate: 157.32,
      asOf: "2026-07-17",
      source: "frankfurter",
    });
    const res = await GET(localReq());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      rate: 157.32,
      asOf: "2026-07-17",
      source: "frankfurter",
    });
  });

  it("returns 502 on upstream failure", async () => {
    vi.mocked(fetchUsdJpyQuote).mockRejectedValue(new Error("upstream down"));
    const res = await GET(localReq());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/upstream/i);
  });
});
