import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CursorCliProxyAuth } from "./CursorCliProxyAuth";

const { getJson, sendJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  getJson,
  sendJson,
}));

beforeEach(() => {
  getJson.mockReset();
  sendJson.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CursorCliProxyAuth", () => {
  it("shows the connected badge when cursor-agent is authenticated", async () => {
    getJson.mockResolvedValue({ connected: true });

    render(<CursorCliProxyAuth />);

    expect(await screen.findByText("接続済み")).toBeTruthy();
    expect(getJson).toHaveBeenCalledWith("/api/provider/cursor/auth");
  });

  it("shows the disconnected badge and a retry button when not authenticated", async () => {
    getJson.mockResolvedValue({ connected: false });

    render(<CursorCliProxyAuth />);

    expect(await screen.findByText("未接続")).toBeTruthy();
    const retry = screen.getByRole("button", { name: "再確認" });
    expect(retry).toBeTruthy();

    getJson.mockResolvedValueOnce({ connected: true });
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText("接続済み")).toBeTruthy());
  });

  it("shows a retry button on error and recovers on retry", async () => {
    getJson.mockRejectedValueOnce(new Error("network error"));

    render(<CursorCliProxyAuth />);

    const retry = await screen.findByRole("button", { name: "再試行" });
    getJson.mockResolvedValueOnce({ connected: true });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText("接続済み")).toBeTruthy());
  });
});
