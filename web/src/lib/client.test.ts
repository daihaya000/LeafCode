import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getJson, ocJson, sendJson, timedFetch } from "./client";

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

    const error = await ocJson("/session/status", "/repo").catch((err) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(503);
  });

  it.each([
    ["getJson", () => getJson("/api/tasks", undefined, { timeoutMs: 1000 })],
    ["sendJson", () => sendJson("POST", "/api/tasks", {}, undefined, { timeoutMs: 1000 })],
    ["ocJson", () => ocJson("/session/status", "/repo", { timeoutMs: 1000 })],
  ])("%s converts a body read timeout to ApiError 408", async (_name, call) => {
    vi.useFakeTimers();
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: () => new Promise<unknown>(() => {}),
    })));

    const pending = call().catch((err) => err);
    await vi.advanceTimersByTimeAsync(1000);
    const error = await pending;
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(408);
  });
});


describe("getJson timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("aborts when the default timeout elapses", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );

    const pending = getJson("/api/tasks");
    const expectation = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(30_000);
    await expectation;
  });
});

describe("getJson body read timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("aborts when the body read hangs past the timeout", async () => {
    vi.useFakeTimers();
    let releaseBody!: (value: unknown) => void;
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            new Promise<unknown>((resolve) => {
              releaseBody = resolve;
              // Never resolves — simulates a hung body read
            }),
        }),
      ),
    );

    const pending = getJson("/api/tasks", undefined, { timeoutMs: 1000 }).catch(
      (err) => err,
    );
    await vi.advanceTimersByTimeAsync(1000);
    const error = await pending;
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(408);
    releaseBody({});
  });
});

describe("timedFetch body readers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(["json", "text", "arrayBuffer", "blob", "formData"] as const)(
    "wraps %s and rejects with ApiError 408 when it hangs",
    async (reader) => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn(async () => ({
        ok: true,
        [reader]: () => new Promise<unknown>(() => {}),
      })));

      const response = await timedFetch("/api/tasks", { timeoutMs: 1000 });
      const pending = response[reader]().catch((err) => err);
      await vi.advanceTimersByTimeAsync(1000);
      const error = await pending;
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(408);
    },
  );

  it("surfaces non-abort body reader errors", async () => {
    const bodyError = new Error("body read failed");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: () => Promise.reject(bodyError),
    })));

    const response = await timedFetch("/api/tasks", { timeoutMs: 1000 });
    await expect(response.json()).rejects.toBe(bodyError);
  });

  it("converts a body stream read timeout to ApiError 408", async () => {
    vi.useFakeTimers();
    let releaseRead!: (result: ReadableStreamReadResult<Uint8Array>) => void;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>((resolve) => {
          releaseRead = () => resolve();
        });
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, body })));

    const res = await timedFetch("/api/tasks", { timeoutMs: 1000 });
    const pending = res.body!.getReader().read().catch((err) => err);
    await vi.advanceTimersByTimeAsync(1000);
    const error = await pending;
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(408);
    releaseRead({ done: true, value: undefined });
  });
});
