import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserBridgeApprovals } from "./BrowserBridgeApprovals";

const { timedFetch } = vi.hoisted(() => ({ timedFetch: vi.fn() }));
vi.mock("@/lib/client", () => ({ timedFetch }));

const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

describe("BrowserBridgeApprovals", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    timedFetch.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("stays hidden when the local Broker is unavailable", async () => {
    timedFetch.mockResolvedValue(response({ approvals: [], available: false }));
    render(<BrowserBridgeApprovals />);
    await waitFor(() => expect(timedFetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("region", { name: "Browser Bridge 承認" })).toBeNull();
  });

  it("shows a safe error when the local Broker request fails", async () => {
    timedFetch.mockRejectedValue(new Error("Browser Bridgeに接続できません"));
    render(<BrowserBridgeApprovals />);
    expect(await screen.findByText("Browser Bridgeに接続できません")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Browser Bridge 承認" })).toBeTruthy();
  });

  it("renders approval metadata and forwards an allow decision", async () => {
    timedFetch
      .mockResolvedValueOnce(response({ available: true, approvals: [{ approvalId: "approval_abcdefghijklmnopqrstuvwxyz", tool: "browser_click", origin: "https://example.test", createdAt: 1 }] }))
      .mockResolvedValueOnce(response({ approvalId: "approval_abcdefghijklmnopqrstuvwxyz", decision: "allow" }))
      .mockResolvedValueOnce(response({ available: true, approvals: [] }));
    render(<BrowserBridgeApprovals />);
    expect(await screen.findByText("browser_click")).toBeTruthy();
    expect(screen.getByText("https://example.test")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "許可" }));
    await waitFor(() => expect(timedFetch).toHaveBeenCalledWith(
      "/api/host/browser-bridge/approvals/approval_abcdefghijklmnopqrstuvwxyz",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "allow" }) }),
    ));
    expect(await screen.findByText("保留中の承認はありません。")).toBeTruthy();
  });

  it("generates a one-time pairing code without exposing broker credentials", async () => {
    timedFetch
      .mockResolvedValueOnce(response({ available: true, approvals: [] }))
      .mockResolvedValueOnce(response({ code: "pairing_code_1234567890" }));
    render(<BrowserBridgeApprovals />);
    await screen.findByText("保留中の承認はありません。");
    fireEvent.click(screen.getByRole("button", { name: "ペアリングコードを生成" }));
    expect((await screen.findByLabelText("ペアリングコード")).textContent).toBe("pairing_code_1234567890");
    expect(timedFetch).toHaveBeenCalledWith("/api/host/browser-bridge/pairing", expect.objectContaining({ method: "POST" }));
  });
});
