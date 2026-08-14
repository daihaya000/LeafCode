import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAISubscriptionAuth } from "./OpenAISubscriptionAuth";

const { getJson, sendJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  getJson,
  sendJson,
}));

function mockApi(connected: boolean) {
  getJson.mockImplementation((path: string) => {
    if (path === "/api/opencode/provider/auth") {
      return Promise.resolve({
        openai: [
          { type: "oauth", label: "ChatGPT Pro/Plus (browser)" },
          { type: "oauth", label: "ChatGPT Pro/Plus (headless)" },
        ],
      });
    }
    if (path === "/api/opencode/provider") {
      return Promise.resolve({ connected: connected ? ["openai"] : [] });
    }
    return Promise.reject(new Error(`Unexpected getJson: ${path}`));
  });
}

beforeEach(() => {
  getJson.mockReset();
  sendJson.mockReset();
  sendJson.mockResolvedValue({
    url: "https://auth.openai.com/oauth/authorize?state=test",
    method: "auto",
    instructions: "Complete authorization in your browser.",
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OpenAISubscriptionAuth", () => {
  it("shows the connected state for an OpenAI subscription", async () => {
    mockApi(true);

    render(<OpenAISubscriptionAuth />);

    expect(
      await screen.findByText("OpenAI サブスクリプション"),
    ).toBeTruthy();
    expect(await screen.findByText("接続済み")).toBeTruthy();
    expect(screen.getByRole("button", { name: "再認証" })).toBeTruthy();
  });

  it("keeps the authorization page open while re-authenticating a connected account", async () => {
    mockApi(true);
    const popup = {
      location: { href: "about:blank" },
      close: vi.fn(),
    } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(popup);

    render(<OpenAISubscriptionAuth />);
    fireEvent.click(await screen.findByRole("button", { name: "再認証" }));

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "POST",
        "/api/provider/openai/oauth/authorize",
        { method: 0 },
      ),
    );
    // The pre-existing connection must not immediately end the re-auth flow.
    expect(
      await screen.findByRole("link", { name: /認証ページを開く/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "認証完了を確認" })).toBeTruthy();
    expect(popup.location.href).toBe(
      "https://auth.openai.com/oauth/authorize?state=test",
    );
    open.mockRestore();
  });

  it("starts browser authentication and provides a fallback link", async () => {
    mockApi(false);
    const popup = {
      location: { href: "about:blank" },
      close: vi.fn(),
    } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(popup);

    render(<OpenAISubscriptionAuth />);
    const button = await screen.findByRole("button", { name: "ブラウザで認証" });
    fireEvent.click(button);

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "POST",
        "/api/provider/openai/oauth/authorize",
        { method: 0 },
      ),
    );
    // The popup handle must stay usable: `noopener`/`noreferrer` make
    // window.open return null in real browsers, silently dropping the
    // navigation and leaving a blank popup behind.
    expect(String(open.mock.calls[0]?.[2] ?? "")).not.toMatch(/noopener|noreferrer/);
    expect(popup.location.href).toBe(
      "https://auth.openai.com/oauth/authorize?state=test",
    );
    expect(
      await screen.findByRole("link", { name: /認証ページを開く/ }),
    ).toBeTruthy();
  });

  it("does not start a second browser authentication while the first is pending", async () => {
    mockApi(false);
    let resolveAuthorization!: (value: unknown) => void;
    sendJson.mockReturnValue(
      new Promise((resolve) => {
        resolveAuthorization = resolve;
      }),
    );
    vi.spyOn(window, "open").mockReturnValue(null);

    render(<OpenAISubscriptionAuth />);
    const button = await screen.findByRole("button", { name: "ブラウザで認証" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(sendJson).toHaveBeenCalledTimes(1);
    resolveAuthorization({
      url: "https://auth.openai.com/oauth/authorize?state=test",
      method: "auto",
    });
    await waitFor(() => expect(screen.getByRole("link", { name: /認証ページを開く/ })).toBeTruthy());
  });

  it("shows busy feedback while manually checking authentication", async () => {
    mockApi(false);
    vi.spyOn(window, "open").mockReturnValue(null);

    render(<OpenAISubscriptionAuth />);
    const startButton = await screen.findByRole("button", { name: "ブラウザで認証" });
    fireEvent.click(startButton);
    await screen.findByRole("button", { name: "認証完了を確認" });

    let resolveCheck!: (value: unknown) => void;
    getJson.mockImplementation((path: string) => {
      if (path === "/api/opencode/provider") {
        return new Promise((resolve) => {
          resolveCheck = resolve;
        });
      }
      if (path === "/api/opencode/provider/auth") {
        return Promise.resolve({
          openai: [{ type: "oauth", label: "ChatGPT Pro/Plus (browser)" }],
        });
      }
      return Promise.reject(new Error(`Unexpected getJson: ${path}`));
    });

    fireEvent.click(screen.getByRole("button", { name: "認証完了を確認" }));
    const checking = screen.getByRole("button", { name: "確認中…" }) as HTMLButtonElement;
    expect(checking.disabled).toBe(true);

    resolveCheck({ connected: [] });
    await waitFor(() => {
      const retry = screen.getByRole("button", { name: "認証完了を確認" }) as HTMLButtonElement;
      expect(retry.disabled).toBe(false);
    });
  });

  it("pauses authentication polling while the page is hidden", async () => {
    mockApi(false);
    vi.spyOn(window, "open").mockReturnValue(null);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    render(<OpenAISubscriptionAuth />);
    fireEvent.click(await screen.findByRole("button", { name: "ブラウザで認証" }));
    await screen.findByRole("button", { name: "認証完了を確認" });
    await waitFor(() => expect(getJson).toHaveBeenCalledTimes(3));

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    fireEvent(document, new Event("visibilitychange"));
    const callsWhileVisible = getJson.mock.calls.length;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(getJson).toHaveBeenCalledTimes(callsWhileVisible);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(getJson.mock.calls.length).toBeGreaterThan(callsWhileVisible));
    vi.useRealTimers();
  });
});
