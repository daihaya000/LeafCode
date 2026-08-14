import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useSubscriptionOAuth,
  type UseSubscriptionOAuthConfig,
} from "./use-subscription-oauth";

const { getJson, sendJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  getJson,
  sendJson,
}));

function baseConfig(overrides: Partial<UseSubscriptionOAuthConfig> = {}): UseSubscriptionOAuthConfig {
  return {
    providerKey: "test-provider",
    methodsEndpoint: "/api/opencode/provider/auth",
    providerEndpoint: "/api/opencode/provider",
    authorizeEndpoint: "/api/opencode/authorize",
    popupName: "test-popup",
    findMethodIndex: (methods) =>
      methods.findIndex((m) => m.type === "oauth"),
    isConnected: (value) => Array.isArray(value) && value.includes("test-provider"),
    notAvailableMessage: "not available",
    loadErrorMessage: "load failed",
    timeoutMessage: "timed out",
    startErrorMessage: "start failed",
    ...overrides,
  };
}

beforeEach(() => {
  getJson.mockReset();
  sendJson.mockReset();
  sendJson.mockResolvedValue({
    url: "https://auth.example.com/authorize?state=test",
    method: "auto",
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useSubscriptionOAuth", () => {
  it("reports connected when the provider is already connected", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/opencode/provider/auth") {
        return Promise.resolve({
          "test-provider": [{ type: "oauth", label: "OAuth" }],
        });
      }
      if (path === "/api/opencode/provider") {
        return Promise.resolve({ connected: ["test-provider"] });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    const { result } = renderHook(() => useSubscriptionOAuth(baseConfig()));

    await waitFor(() => {
      expect(result.current.state).toBe("connected");
    });
    expect(result.current.connected).toBe(true);
    expect(result.current.methodIndex).toBe(0);
  });

  it("becomes ready when not connected", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/opencode/provider/auth") {
        return Promise.resolve({
          "test-provider": [{ type: "oauth", label: "OAuth" }],
        });
      }
      if (path === "/api/opencode/provider") {
        return Promise.resolve({ connected: [] });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    const { result } = renderHook(() => useSubscriptionOAuth(baseConfig()));

    await waitFor(() => {
      expect(result.current.state).toBe("ready");
    });
    expect(result.current.connected).toBe(false);
  });

  it("moves to error when the OAuth method is unavailable", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/opencode/provider/auth") {
        return Promise.resolve({ "test-provider": [] });
      }
      if (path === "/api/opencode/provider") {
        return Promise.resolve({ connected: [] });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    const { result } = renderHook(() => useSubscriptionOAuth(baseConfig()));

    await waitFor(() => {
      expect(result.current.state).toBe("error");
    });
    expect(result.current.error).toBe("not available");
  });

  it("starts the OAuth flow and moves to waiting", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/opencode/provider/auth") {
        return Promise.resolve({
          "test-provider": [{ type: "oauth", label: "OAuth" }],
        });
      }
      if (path === "/api/opencode/provider") {
        return Promise.resolve({ connected: [] });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    const popup = { location: { href: "" } } as unknown as Window;
    const originalOpen = window.open;
    window.open = vi.fn(() => popup) as typeof window.open;

    const { result } = renderHook(() => useSubscriptionOAuth(baseConfig()));

    await waitFor(() => {
      expect(result.current.state).toBe("ready");
    });

    await act(async () => {
      await result.current.start();
    });

    expect(sendJson).toHaveBeenCalledWith(
      "POST",
      "/api/opencode/authorize",
      { method: 0 },
    );
    expect(result.current.state).toBe("waiting");
    expect(result.current.authUrl).toBe(
      "https://auth.example.com/authorize?state=test",
    );
    window.open = originalOpen;
  });

  it("keeps a re-auth waiting instead of resolving on the previous connection", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/opencode/provider/auth") {
        return Promise.resolve({
          "test-provider": [{ type: "oauth", label: "OAuth" }],
        });
      }
      if (path === "/api/opencode/provider") {
        // A re-auth never changes this: the provider stays connected on the
        // credentials that are about to be replaced.
        return Promise.resolve({ connected: ["test-provider"] });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    const popup = { location: { href: "" } } as unknown as Window;
    const originalOpen = window.open;
    window.open = vi.fn(() => popup) as typeof window.open;
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { result } = renderHook(() => useSubscriptionOAuth(baseConfig()));

    await waitFor(() => {
      expect(result.current.state).toBe("connected");
    });

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe("waiting");
    expect(result.current.reauth).toBe(true);
    expect(popup.location.href).toBe(
      "https://auth.example.com/authorize?state=test",
    );

    // Polling must stay off; otherwise the old connection ends the flow at once.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(result.current.state).toBe("waiting");
    expect(result.current.authUrl).toBe(
      "https://auth.example.com/authorize?state=test",
    );

    await act(async () => {
      await result.current.checkConnection();
    });
    expect(result.current.state).toBe("connected");
    expect(result.current.reauth).toBe(false);

    vi.useRealTimers();
    window.open = originalOpen;
  });

  it("opens the popup with a handle that can be navigated", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/opencode/provider/auth") {
        return Promise.resolve({
          "test-provider": [{ type: "oauth", label: "OAuth" }],
        });
      }
      if (path === "/api/opencode/provider") {
        return Promise.resolve({ connected: [] });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    const popup = { location: { href: "" } } as unknown as Window;
    const open = vi.fn(() => popup) as typeof window.open;
    const originalOpen = window.open;
    window.open = open;

    const { result } = renderHook(() => useSubscriptionOAuth(baseConfig()));
    await waitFor(() => {
      expect(result.current.state).toBe("ready");
    });
    await act(async () => {
      await result.current.start();
    });

    // `noopener`/`noreferrer` would make window.open return null.
    expect(String(vi.mocked(open).mock.calls[0]?.[2] ?? "")).not.toMatch(
      /noopener|noreferrer/,
    );
    expect(popup.location.href).toBe(
      "https://auth.example.com/authorize?state=test",
    );
    window.open = originalOpen;
  });

  it("recovers to ready when the authorize call fails", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/opencode/provider/auth") {
        return Promise.resolve({
          "test-provider": [{ type: "oauth", label: "OAuth" }],
        });
      }
      if (path === "/api/opencode/provider") {
        return Promise.resolve({ connected: [] });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    sendJson.mockRejectedValue(new Error("authorize failed"));
    const originalOpen = window.open;
    window.open = vi.fn(() => null) as typeof window.open;

    const { result } = renderHook(() => useSubscriptionOAuth(baseConfig()));

    await waitFor(() => {
      expect(result.current.state).toBe("ready");
    });

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe("ready");
    expect(result.current.error).toBe("authorize failed");
    window.open = originalOpen;
  });
});
