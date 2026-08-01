import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelRankingSettings } from "./ModelRankingSettings";

const getJson = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client", () => ({ getJson }));
vi.mock("@/lib/currency", () => ({
  formatCostValue: (value: number) => `$${value.toFixed(4)}`,
  useCostDisplayPrefs: () => ({ currency: "USD", usdJpyRate: 150, showUsdSuffix: false }),
}));
vi.mock("@addons/codexbar", () => ({ providerIconSrcForOpencodeId: () => null }));

describe("ModelRankingSettings", () => {
  it("renders the history-based ranking and supports an empty result", async () => {
    getJson.mockResolvedValueOnce({
      rankings: [
        {
          providerID: "openai",
          modelID: "gpt-test",
          sessions: 2,
          turns: 3,
          tokens: 1200,
          cost: 0.12,
          tokensPerDollar: 10000,
        },
      ],
    });

    render(<ModelRankingSettings />);
    expect(await screen.findByText("gpt-test")).toBeTruthy();
    expect(screen.getByText("10,000")).toBeTruthy();
    expect(screen.getByText("$0.1200")).toBeTruthy();
  });

  it("shows an error and retry action when loading fails", async () => {
    getJson.mockRejectedValueOnce(new Error("offline"));
    render(<ModelRankingSettings />);
    expect(await screen.findByText("セッション履歴を取得できませんでした。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "再試行" })).toBeTruthy();
  });
});
