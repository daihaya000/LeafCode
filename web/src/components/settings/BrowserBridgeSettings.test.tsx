import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserBridgeSettings } from "./BrowserBridgeSettings";

const { timedFetch } = vi.hoisted(() => ({ timedFetch: vi.fn() }));
vi.mock("@/lib/client", () => ({ timedFetch }));

const response = (body: unknown, ok = true) =>
  ({ ok, json: async () => body }) as Response;

describe("BrowserBridgeSettings", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    timedFetch.mockReset();
  });
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem("browser-bridge-broker-url");
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("shows the connection form when no connection is saved", async () => {
    timedFetch.mockResolvedValue(response({ available: false }));
    render(<BrowserBridgeSettings />);
    expect(await screen.findByLabelText("Broker URL")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "この URL で接続" }),
    ).toBeTruthy();
  });

  it("restores a saved secure wss Broker URL", async () => {
    window.localStorage.setItem(
      "browser-bridge-broker-url",
      "wss://bridge.example.test/extension",
    );
    timedFetch.mockResolvedValue(response({ available: false }));

    render(<BrowserBridgeSettings />);

    expect(await screen.findByDisplayValue("wss://bridge.example.test/extension")).toBeTruthy();
  });

  it("collapses the connection form once the Broker reports connected", async () => {
    timedFetch.mockResolvedValue(
      response({ available: true, connected: true, paired: true }),
    );
    render(<BrowserBridgeSettings />);
    await waitFor(() =>
      expect(screen.getByText("接続済み")).toBeTruthy(),
    );
    expect(screen.queryByLabelText("Broker URL")).toBeNull();
    expect(
      screen.getByRole("button", { name: "接続設定を変更" }),
    ).toBeTruthy();
  });

  it("expands the form when the edit button is clicked", async () => {
    timedFetch.mockResolvedValue(
      response({ available: true, connected: true, paired: true }),
    );
    render(<BrowserBridgeSettings />);
    await waitFor(() =>
      expect(screen.getByText("接続済み")).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "接続設定を変更" }),
    );
    expect(await screen.findByLabelText("Broker URL")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "接続設定を折りたたむ" }),
    ).toBeTruthy();
  });

  it("shows an error and re-enables the connect button on failure", async () => {
    timedFetch.mockRejectedValue(new Error("Broker に接続できません"));
    render(<BrowserBridgeSettings />);
    fireEvent.click(screen.getByRole("button", { name: "この URL で接続" }));
    expect(
      await screen.findByText("Broker に接続できません"),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "この URL で接続" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("uses the fresh status response when connecting", async () => {
    timedFetch
      .mockResolvedValueOnce(response({ available: false }))
      .mockResolvedValueOnce(response({ available: true, connected: true, paired: true }));
    render(<BrowserBridgeSettings />);
    await screen.findByLabelText("Broker URL");

    fireEvent.click(screen.getByRole("button", { name: "この URL で接続" }));

    await waitFor(() => expect(screen.getByText("接続済み")).toBeTruthy());
    expect(screen.queryByText("Broker に接続できません")).toBeNull();
  });

  it("disables the connect button while submitting", async () => {
    let resolveStatus: (r: Response) => void = () => {};
    timedFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );
    render(<BrowserBridgeSettings />);
    const connect = screen.getByRole("button", { name: "この URL で接続" }) as HTMLButtonElement;
    fireEvent.click(connect);
    await waitFor(() => expect(connect.disabled).toBe(true));
    resolveStatus(response({ available: true, connected: true, paired: true }));
    await waitFor(() => expect(screen.getByText("接続済み")).toBeTruthy());
  });

  it("clears the saved connection when delete is clicked", async () => {
    timedFetch.mockResolvedValue(
      response({ available: true, connected: true, paired: true }),
    );
    render(<BrowserBridgeSettings />);
    await waitFor(() =>
      expect(screen.getByText("接続済み")).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "この接続を削除" }),
    );
    expect(screen.queryByText("接続済み")).toBeNull();
    expect(await screen.findByLabelText("Broker URL")).toBeTruthy();
  });

  it("does not restore a dismissed connection from the next status poll", async () => {
    timedFetch.mockResolvedValue(response({ available: true, connected: true, paired: true }));
    render(<BrowserBridgeSettings />);
    await waitFor(() => expect(screen.getByText("接続済み")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "この接続を削除" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.queryByText("接続済み")).toBeNull();
  });
  it("does not overlap background status polls", async () => {
    let resolveFirst: (value: Response) => void = () => {};
    timedFetch
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => { resolveFirst = resolve; }),
      )
      .mockResolvedValue(response({ available: false }));
    render(<BrowserBridgeSettings />);
    await waitFor(() => expect(timedFetch).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(6000);
    expect(timedFetch).toHaveBeenCalledTimes(1);

    resolveFirst(response({ available: false }));
    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => expect(timedFetch).toHaveBeenCalledTimes(2));
  });

  it("keeps the newer manual status when an older poll resolves later", async () => {
    let resolveFirst: (value: Response) => void = () => {};
    timedFetch
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => { resolveFirst = resolve; }),
      )
      .mockResolvedValue(response({ available: true, connected: true, paired: true }));
    render(<BrowserBridgeSettings />);
    const connect = screen
      .getAllByRole("button")
      .find((button) => button.textContent?.includes("URL")) as HTMLButtonElement;
    fireEvent.click(connect);
    await waitFor(() => expect(screen.queryByLabelText("Broker URL")).toBeNull());

    resolveFirst(response({ available: false }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByLabelText("Broker URL")).toBeNull();
  });
});
