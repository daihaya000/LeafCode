import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeSubscriptionAuth } from "./ClaudeSubscriptionAuth";

const { getJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  getJson,
}));

beforeEach(() => {
  getJson.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ClaudeSubscriptionAuth", () => {
  it("shows the connected badge when claude is authenticated", async () => {
    getJson.mockResolvedValue({ connected: true });

    render(<ClaudeSubscriptionAuth />);

    expect(await screen.findByText("接続済み")).toBeTruthy();
    expect(getJson).toHaveBeenCalledWith("/api/provider/claude/auth");
  });

  it("shows the disconnected badge and a retry button when not authenticated", async () => {
    getJson.mockResolvedValue({ connected: false });

    render(<ClaudeSubscriptionAuth />);

    expect(await screen.findByText("未接続")).toBeTruthy();
    const retry = screen.getByRole("button", { name: "再確認" });
    expect(retry).toBeTruthy();

    getJson.mockResolvedValueOnce({ connected: true });
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText("接続済み")).toBeTruthy());
  });

  it("shows a retry button on error and recovers on retry", async () => {
    getJson.mockRejectedValueOnce(new Error("network error"));

    render(<ClaudeSubscriptionAuth />);

    const retry = await screen.findByRole("button", { name: "再試行" });
    getJson.mockResolvedValueOnce({ connected: true });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText("接続済み")).toBeTruthy());
  });
});
