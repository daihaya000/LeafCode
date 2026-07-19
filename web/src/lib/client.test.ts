import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, ocJson } from "./client";

describe("ocJson timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("aborts when timeoutMs elapses before the response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", { origin: "http://localhost:3000" });

    const pending = ocJson("/session/status", "/repo", { timeoutMs: 1000 });
    const expectation = expect(pending).rejects.toThrow(/timed out|timeout|abort|Aborted/i);

    await vi.advanceTimersByTimeAsync(1000);
    await expectation;
    expect(fetchMock).toHaveBeenCalled();
  });

  it("returns JSON when the response arrives before timeout", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ a: 1 }),
      })),
    );

    await expect(ocJson("/session/status", "/repo", { timeoutMs: 5000 })).resolves.toEqual({
      a: 1,
    });
  });

  it("still surfaces HTTP errors", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: "down" }),
      })),
    );

    await expect(ocJson("/session/status", "/repo")).rejects.toBeInstanceOf(ApiError);
  });
});
