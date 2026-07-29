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

  it("recovers from a transient refresh failure on the next poll", async () => {
    timedFetch
      .mockRejectedValueOnce(new Error("Browser Bridgeに接続できません"))
      .mockResolvedValueOnce(response({ available: true, approvals: [] }));
    render(<BrowserBridgeApprovals />);
    expect(await screen.findByText("Browser Bridgeに接続できません")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(await screen.findByText("保留中の承認はありません。")).toBeTruthy();
    expect(screen.queryByText("Browser Bridgeに接続できません")).toBeNull();
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

  it("forwards a deny decision and refreshes the expired card to empty state", async () => {
    timedFetch
      .mockResolvedValueOnce(response({ available: true, approvals: [{ approvalId: "approval_abcdefghijklmnopqrstuvwxyz", tool: "browser_navigate", origin: "https://example.test", createdAt: 1 }] }))
      .mockResolvedValueOnce(response({ approvalId: "approval_abcdefghijklmnopqrstuvwxyz", decision: "deny" }))
      .mockResolvedValueOnce(response({ available: true, approvals: [] }));
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
      .mockResolvedValueOnce(response({ error: "unavailable" }, false));
    render(<BrowserBridgeApprovals />);
    const allow = await screen.findByRole("button", { name: "許可" });
    fireEvent.click(allow);
    expect(await screen.findByText("承認の更新に失敗しました")).toBeTruthy();
    expect((screen.getByRole("button", { name: "許可" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "拒否" }) as HTMLButtonElement).disabled).toBe(false);
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

  it("shows a pairing generation error without rendering a code", async () => {
    timedFetch
      .mockResolvedValueOnce(response({ available: true, approvals: [] }))
      .mockResolvedValueOnce(response({ error: "unavailable" }, false));
    render(<BrowserBridgeApprovals />);
    await screen.findByText("保留中の承認はありません。");
    fireEvent.click(screen.getByRole("button", { name: "ペアリングコードを生成" }));
    expect(await screen.findByText("ペアリングコードを生成できません")).toBeTruthy();
    expect(screen.queryByLabelText("ペアリングコード")).toBeNull();
    expect(screen.getByRole("button", { name: "ペアリングコードを生成" })).toBeTruthy();
  });
});
