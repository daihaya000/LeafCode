import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexBarWidget } from "./CodexBarWidget";

const { getJson } = vi.hoisted(() => ({ getJson: vi.fn() }));

vi.mock("@/lib/client", () => ({ getJson }));
vi.mock("@/lib/addons/state", () => ({ writeAddonEnabled: vi.fn() }));

describe("CodexBarWidget credits", () => {
  beforeEach(() => {
    localStorage.setItem("webui:addon:codexbar:collapsed", "0");
    localStorage.removeItem("webui:addon:codexbar:providers");
    localStorage.removeItem("webui:plugin:codexbar:collapsed");
    localStorage.removeItem("webui:plugin:codexbar:providers");
    getJson.mockReset();
    getJson.mockImplementation((url: string) => {
      if (url.endsWith("/tokens")) {
        return Promise.resolve({ available: false });
      }
      return Promise.resolve({
        available: true,
        reason: null,
        schema: "codexbar.usage-snapshot/v1",
        generatedAt: null,
        subscriptionTotalMonthlyUsd: 100,
        providers: [
          {
            id: "claude",
            opencodeId: "anthropic",
            plan: "Max",
            planMonthlyUsd: 100,
            usedPercent: null,
            limited: false,
            maxed: false,
            resetsAt: null,
            updatedAt: null,
            error: null,
            windows: [],
            credits: {
              title: "利用クレジット",
              used: 12.5,
              limit: 300,
              balance: 287.5,
            },
          },
        ],
      });
    });
  });

  it("shows credit usage and balance in an expanded provider", async () => {
    render(<CodexBarWidget />);

    expect(await screen.findByText("利用クレジット")).not.toBeNull();
    expect(screen.getByText("$12.50 / $300.00")).not.toBeNull();
    expect(screen.getByText("残高 $287.50")).not.toBeNull();
  });
});
