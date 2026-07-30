import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    timedFetch.mockResolvedValue(response({ approvals: [], requests: [], available: false }));
    render(<BrowserBridgeApprovals />);
    await waitFor(() => expect(timedFetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("region", { name: "Browser Bridge 承認" })).toBeNull();
  });

  it("shows a safe error when the local Broker request fails", async () => {
    timedFetch.mockRejectedValue(new Error("Browser Bridgeに接続できません"));
    render(<BrowserBridgeApprovals />);
    expect(await screen.findByText("Browser Bridgeに接続できません")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Browser Bridge 承認" })).toBeTruthy();
  });

  it("recovers from a transient refresh failure on the next poll", async () => {
    // Each refresh does two parallel fetches (approvals, then pairing) in
    // that order, so mocks must be queued in pairs per refresh cycle.
    timedFetch
      .mockRejectedValueOnce(new Error("Browser Bridgeに接続できません")) // refresh 1: approvals
      .mockResolvedValueOnce(response({ available: true, requests: [] })) // refresh 1: pairing
      .mockResolvedValueOnce(response({ available: true, approvals: [] })) // refresh 2: approvals
      .mockResolvedValueOnce(response({ available: true, requests: [] })); // refresh 2: pairing
    render(<BrowserBridgeApprovals />);
    expect(await screen.findByText("Browser Bridgeに接続できません")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(await screen.findByText("保留中の承認はありません。")).toBeTruthy();
    expect(screen.queryByText("Browser Bridgeに接続できません")).toBeNull();
  });

  it("renders approval metadata and forwards an allow decision", async () => {
    timedFetch
      .mockResolvedValueOnce(response({ available: true, approvals: [{ approvalId: "approval_abcdefghijklmnopqrstuvwxyz", tool: "browser_click", origin: "https://example.test", createdAt: 1 }] }))
      .mockResolvedValueOnce(response({ available: true, requests: [] }))
      .mockResolvedValueOnce(response({ approvalId: "approval_abcdefghijklmnopqrstuvwxyz", decision: "allow" }))
      .mockResolvedValueOnce(response({ available: true, approvals: [] }))
      .mockResolvedValueOnce(response({ available: true, requests: [] }));
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

  it("forwards a deny decision and refreshes the expired card to empty state", async () => {
    timedFetch
      .mockResolvedValueOnce(response({ available: true, approvals: [{ approvalId: "approval_abcdefghijklmnopqrstuvwxyz", tool: "browser_navigate", origin: "https://example.test", createdAt: 1 }] }))
      .mockResolvedValueOnce(response({ available: true, requests: [] }))
      .mockResolvedValueOnce(response({ approvalId: "approval_abcdefghijklmnopqrstuvwxyz", decision: "deny" }))
      .mockResolvedValueOnce(response({ available: true, approvals: [] }))
      .mockResolvedValueOnce(response({ available: true, requests: [] }));
    render(<BrowserBridgeApprovals />);
    fireEvent.click(await screen.findByRole("button", { name: "拒否" }));
    await waitFor(() => expect(timedFetch).toHaveBeenCalledWith(
      "/api/host/browser-bridge/approvals/approval_abcdefghijklmnopqrstuvwxyz",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "deny" }) }),
    ));
    expect(await screen.findByText("保留中の承認はありません。")).toBeTruthy();
  });

  it("shows a decision error and re-enables the approval actions", async () => {
    timedFetch
      .mockResolvedValueOnce(response({ available: true, approvals: [{ approvalId: "approval_abcdefghijklmnopqrstuvwxyz", tool: "browser_click", origin: "https://example.test", createdAt: 1 }] }))
      .mockResolvedValueOnce(response({ available: true, requests: [] }))
      .mockResolvedValueOnce(response({ error: "unavailable" }, false));
    render(<BrowserBridgeApprovals />);
    const allow = await screen.findByRole("button", { name: "許可" });
    fireEvent.click(allow);
    expect(await screen.findByText("承認の更新に失敗しました")).toBeTruthy();
    expect((screen.getByRole("button", { name: "許可" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "拒否" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a pending pairing request and forwards an allow decision without any code to type", async () => {
    const requestId = "pairing_request_abcdefghijklmnopqrstuvwxyz";
    timedFetch
      .mockResolvedValueOnce(response({ available: true, approvals: [] }))
      .mockResolvedValueOnce(response({ available: true, requests: [{ requestId, origin: "chrome-extension://abcdefghijklmno", createdAt: 1 }] }))
      .mockResolvedValueOnce(response({ requestId, decision: "allow" }))
      .mockResolvedValueOnce(response({ available: true, approvals: [] }))
      .mockResolvedValueOnce(response({ available: true, requests: [] }));
    render(<BrowserBridgeApprovals />);
    expect(await screen.findByText("拡張機能のペアリング要求")).toBeTruthy();
    expect(screen.getByText("chrome-extension://abcdefghijklmno")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "許可" }));
    await waitFor(() => expect(timedFetch).toHaveBeenCalledWith(
      `/api/host/browser-bridge/pairing/${requestId}`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "allow" }) }),
    ));
    expect(await screen.findByText("保留中の承認はありません。")).toBeTruthy();
  });

  it("forwards a deny decision for a pairing request", async () => {
    const requestId = "pairing_request_abcdefghijklmnopqrstuvwxyz";
    timedFetch
      .mockResolvedValueOnce(response({ available: true, approvals: [] }))
      .mockResolvedValueOnce(response({ available: true, requests: [{ requestId, origin: "chrome-extension://abcdefghijklmno", createdAt: 1 }] }))
      .mockResolvedValueOnce(response({ requestId, decision: "deny" }))
      .mockResolvedValueOnce(response({ available: true, approvals: [] }))
      .mockResolvedValueOnce(response({ available: true, requests: [] }));
    render(<BrowserBridgeApprovals />);
    fireEvent.click(await screen.findByRole("button", { name: "拒否" }));
    await waitFor(() => expect(timedFetch).toHaveBeenCalledWith(
      `/api/host/browser-bridge/pairing/${requestId}`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "deny" }) }),
    ));
    expect(await screen.findByText("保留中の承認はありません。")).toBeTruthy();
  });

  it("shows a pairing decision error and re-enables its actions", async () => {
    const requestId = "pairing_request_abcdefghijklmnopqrstuvwxyz";
    timedFetch
      .mockResolvedValueOnce(response({ available: true, approvals: [] }))
      .mockResolvedValueOnce(response({ available: true, requests: [{ requestId, origin: "chrome-extension://abcdefghijklmno", createdAt: 1 }] }))
      .mockResolvedValueOnce(response({ error: "unavailable" }, false));
    render(<BrowserBridgeApprovals />);
    const allow = await screen.findByRole("button", { name: "許可" });
    fireEvent.click(allow);
    expect(await screen.findByText("ペアリング要求の更新に失敗しました")).toBeTruthy();
    expect((screen.getByRole("button", { name: "許可" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "拒否" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
