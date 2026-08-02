import { describe, expect, test, vi } from "vitest";

const { browserBrokerFetch } = vi.hoisted(() => ({ browserBrokerFetch: vi.fn() }));
vi.mock("./browser-bridge", () => ({ browserBrokerFetch }));

import { verifyBrowserBridgeScreenshot } from "./workflow-artifacts";

describe("Browser Bridge Visual Judge artifact contract", () => {
  const sharedTabs = () => new Response(JSON.stringify({ tabs: [{ id: "tab-1", origin: "https://example.test", title: "Preview" }] }), { status: 200 });

  test("requires an explicitly shared tab and preserves its origin", async () => {
    browserBrokerFetch.mockImplementation(sharedTabs);
    await expect(verifyBrowserBridgeScreenshot({ tabId: "tab-1", opaqueRef: "browser-bridge:tab-1", expectedOrigin: "https://example.test" })).resolves.toEqual({ origin: "https://example.test", title: "Preview" });
  });

  test("rejects unknown tabs and ownership mismatches", async () => {
    browserBrokerFetch.mockImplementation(sharedTabs);
    await expect(verifyBrowserBridgeScreenshot({ tabId: "tab-2", opaqueRef: "browser-bridge:tab-2" })).rejects.toHaveProperty("code", "TAB_NOT_SHARED");
    await expect(verifyBrowserBridgeScreenshot({ tabId: "tab-1", opaqueRef: "browser-bridge:tab-1", expectedOrigin: "https://other.test" })).rejects.toHaveProperty("code", "TAB_OWNERSHIP_MISMATCH");
  });
});
