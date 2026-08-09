import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isLoopbackHost,
  isPrivateHost,
  maybeRedirectToLocalhost,
} from "./localhost-redirect";

function stubLocation(href: string) {
  const url = new URL(href);
  vi.stubGlobal("location", {
    href,
    hostname: url.hostname,
    protocol: url.protocol,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    replace: vi.fn(),
  });
}

describe("isLoopbackHost", () => {
  it("accepts loopback forms", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("::ffff:127.0.0.1")).toBe(true);
  });

  it("rejects LAN / public hosts", () => {
    expect(isLoopbackHost("192.168.0.102")).toBe(false);
    expect(isLoopbackHost("10.0.0.1")).toBe(false);
    expect(isLoopbackHost("example.com")).toBe(false);
    expect(isLoopbackHost("")).toBe(false);
  });
});

describe("isPrivateHost", () => {
  it("accepts RFC1918 and link-local ranges", () => {
    expect(isPrivateHost("192.168.0.102")).toBe(true);
    expect(isPrivateHost("10.0.0.5")).toBe(true);
    expect(isPrivateHost("172.16.0.1")).toBe(true);
    expect(isPrivateHost("172.31.255.254")).toBe(true);
    expect(isPrivateHost("169.254.1.1")).toBe(true);
    expect(isPrivateHost("fd00::1")).toBe(true);
  });

  it("accepts the shared VPN address range used by Tailscale", () => {
    expect(isPrivateHost("100.64.0.10")).toBe(true);
    expect(isPrivateHost("100.127.255.254")).toBe(true);
    expect(isPrivateHost("100.63.255.255")).toBe(false);
    expect(isPrivateHost("100.128.0.1")).toBe(false);
  });

  it("rejects loopback and public addresses", () => {
    expect(isPrivateHost("127.0.0.1")).toBe(true); // loopback is trivially private
    expect(isPrivateHost("172.32.0.1")).toBe(false);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
    expect(isPrivateHost("example.com")).toBe(false);
  });
});

describe("maybeRedirectToLocalhost", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does nothing when already on loopback", async () => {
    stubLocation("http://127.0.0.1:3000/");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await maybeRedirectToLocalhost();
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when on a public hostname (reverse proxy)", async () => {
    stubLocation("https://webui.example.com/task/1");
    vi.stubGlobal("fetch", vi.fn());

    const result = await maybeRedirectToLocalhost();
    expect(result).toBeNull();
  });

  it("does nothing when the loopback control plane is unreachable (remote phone)", async () => {
    stubLocation("http://192.168.0.102:3000/task/1");
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await maybeRedirectToLocalhost();
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18765/health",
      expect.objectContaining({ mode: "no-cors" }),
    );
  });

  it("redirects a LAN URL to loopback when the host control plane is reachable", async () => {
    stubLocation("http://192.168.0.102:3000/task/1?tab=overview");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const result = await maybeRedirectToLocalhost();
    expect(result).toBe("http://127.0.0.1:3000/task/1?tab=overview");
    const replace = vi.mocked(window.location.replace);
    expect(replace).toHaveBeenCalledWith("http://127.0.0.1:3000/task/1?tab=overview");
  });

  it("redirects a Tailscale URL to loopback when the host control plane is reachable", async () => {
    stubLocation("https://100.100.10.20:8443/task/1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const result = await maybeRedirectToLocalhost();
    expect(result).toBe("https://127.0.0.1:8443/task/1");
  });

  it("preserves protocol and port while swapping the hostname", async () => {
    stubLocation("https://192.168.1.5:8443/settings");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const result = await maybeRedirectToLocalhost();
    expect(result).toBe("https://127.0.0.1:8443/settings");
  });

  it("is a no-op outside the browser", async () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", { value: undefined, configurable: true });
    try {
      const result = await maybeRedirectToLocalhost();
      expect(result).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
    }
  });
});
