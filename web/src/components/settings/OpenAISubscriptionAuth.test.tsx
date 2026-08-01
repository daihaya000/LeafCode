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

  it("starts browser authentication and provides a fallback link", async () => {
    mockApi(false);
    const popup = {
      location: { href: "about:blank" },
      close: vi.fn(),
    } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(popup);

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
});
