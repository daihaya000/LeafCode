import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  AUTH_REQUIRED_EVENT,
  getJson,
  ocJson,
  sendJson,
  timedFetch,
} from "./client";
import { resetStaleCacheForTests } from "./stale-cache";

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
        text: async () => JSON.stringify({ a: 1 }),
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
        text: async () => JSON.stringify({ error: "down" }),
      })),
    );

    const error = await ocJson("/session/status", "/repo").catch((err) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(503);
  });

  it("resolves with undefined instead of throwing on a 204 No Content response", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
    const jsonSpy = vi.fn(() => Promise.reject(new SyntaxError("Unexpected end of JSON input")));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 204,
        json: jsonSpy,
      })),
    );

    await expect(ocJson("/session/status", "/repo")).resolves.toBeUndefined();
    // 204 must short-circuit before calling the (SyntaxError-throwing) json() reader.
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["getJson", () => getJson("/api/tasks")],
    ["sendJson", () => sendJson("DELETE", "/api/tasks", undefined)],
    ["ocJson", () => ocJson("/session/status", "/repo")],
  ])("%s resolves with undefined instead of throwing on a 205 Reset Content response", async (_name, call) => {
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 205, text: async () => "" })),
    );

    await expect(call()).resolves.toBeUndefined();
  });

  it.each([
    ["getJson", () => getJson("/api/tasks")],
    ["sendJson", () => sendJson("DELETE", "/api/tasks", undefined)],
    ["ocJson", () => ocJson("/session/status", "/repo")],
  ])("%s resolves with undefined instead of throwing on a 200 response with an empty body", async (_name, call) => {
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, text: async () => "" })),
    );

    await expect(call()).resolves.toBeUndefined();
  });

  it("still throws on malformed (non-empty) JSON bodies", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, text: async () => "{not json" })),
    );

    await expect(ocJson("/session/status", "/repo")).rejects.toThrow(SyntaxError);
  });

  /**
   * The engine reports failures as `{_tag, message, service?}`, not
   * `{error}`. Reading only `error` reduced every engine failure to
   * "<path> failed: <status>" — a compact rejected with
   * `503 ServiceUnavailableError` gave the user no reason at all.
   */
  it.each([
    [
      "engine error shape",
      { _tag: "ServiceUnavailableError", message: "provider is unavailable", service: "opencode-go" },
      "provider is unavailable (opencode-go)",
    ],
    ["WebUI route shape", { error: "OpenCode engine unavailable" }, "OpenCode engine unavailable"],
    [
      "detail only",
      { detail: "upstream reset the connection" },
      "upstream reset the connection",
    ],
    [
      "tagged without message",
      { _tag: "ServiceUnavailableError" },
      "ServiceUnavailableError: /api/session/s1/compact failed: 503",
    ],
    ["no body", undefined, "/api/session/s1/compact failed: 503"],
  ])("ocJson surfaces the %s of a failed response", async (_name, body, expected) => {
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        text: async () => (body === undefined ? "" : JSON.stringify(body)),
      })),
    );

    const error = await ocJson("/api/session/s1/compact", "/repo", {
      method: "POST",
      body: {},
    }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(503);
    expect((error as ApiError).message).toBe(expected);
  });

  it.each([
    ["getJson", () => getJson("/api/tasks")],
    ["sendJson", () => sendJson("POST", "/api/tasks", {})],
  ])("%s surfaces an engine-shaped error message", async (_name, call) => {
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ message: "engine exploded" }),
      })),
    );

    await expect(call()).rejects.toThrow("engine exploded");
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
      text: () => new Promise<unknown>(() => {}),
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

describe("getJson in-flight deduplication", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares identical concurrent GETs but fetches again after they settle", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
    let release!: (response: unknown) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = getJson<{ tasks: unknown[] }>("/api/tasks");
    const second = getJson<{ tasks: unknown[] }>("/api/tasks");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release({ ok: true, text: async () => JSON.stringify({ tasks: [] }) });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { tasks: [] },
      { tasks: [] },
    ]);

    const third = getJson<{ tasks: unknown[] }>("/api/tasks");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    release({ ok: true, text: async () => JSON.stringify({ tasks: ["new"] }) });
    await expect(third).resolves.toEqual({ tasks: ["new"] });
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
          text: () =>
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

  it("honors a caller AbortSignal in addition to its timeout", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = timedFetch("/api/tasks", {
      signal: caller.signal,
      timeoutMs: 30_000,
    });
    caller.abort();

    await expect(pending).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).not.toBe(
      caller.signal,
    );
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

describe("getJson stale-while-revalidate cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
    resetStaleCacheForTests();
  });

  function stubFetch(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => JSON.stringify(body),
      })),
    );
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
  }

  it("caches a cacheable GET and serves the fresh entry without refetching", async () => {
    stubFetch({ projects: ["a"] });
    await expect(getJson("/api/projects")).resolves.toEqual({ projects: ["a"] });
    expect(fetch).toHaveBeenCalledTimes(1);

    await expect(getJson("/api/projects")).resolves.toEqual({ projects: ["a"] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not cache dynamic endpoints", async () => {
    stubFetch({ tasks: [] });
    await getJson("/api/tasks");
    await getJson("/api/tasks");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("serves a stale entry immediately and re-validates in the background", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    stubFetch({ projects: ["a"] });
    await getJson("/api/projects");

    // 31s later the 30s fresh window has expired.
    vi.setSystemTime(new Date("2026-01-01T00:00:31Z"));
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(
      async () => ({
        ok: true,
        text: async () => JSON.stringify({ projects: ["b"] }),
      }) as unknown as Response,
    );

    await expect(getJson("/api/projects")).resolves.toEqual({ projects: ["a"] });
    await vi.waitFor(async () => {
      const data = await getJson<{ projects: string[] }>("/api/projects");
      expect(data.projects).toEqual(["b"]);
    });
  });

  it("invalidates cached GETs after a successful write", async () => {
    stubFetch({ projects: ["a"] });
    await getJson("/api/projects");

    stubFetch({ ok: true });
    await sendJson("PATCH", "/api/projects/p1");

    stubFetch({ projects: ["b"] });
    await expect(getJson("/api/projects")).resolves.toEqual({ projects: ["b"] });
  });
});

describe("auth-required 403 notification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    resetStaleCacheForTests();
  });

  it.each([
    ["getJson", () => getJson("/api/tasks")],
    ["sendJson", () => sendJson("POST", "/api/tasks", {})],
    ["ocJson", () => ocJson("/session/status", "/repo")],
  ])(
    "%s dispatches AUTH_REQUIRED_EVENT on a 403 auth-required body",
    async (_name, call) => {
      vi.stubGlobal("location", { origin: "http://192.168.0.5:3000" });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: false,
          status: 403,
          text: async () =>
            JSON.stringify({
              error: "this endpoint requires the host machine or a signed-in session",
              code: "auth-required",
            }),
        })),
      );

      const listener = vi.fn();
      window.addEventListener(AUTH_REQUIRED_EVENT, listener);

      await call().catch(() => {});
      expect(listener).toHaveBeenCalledTimes(1);
      window.removeEventListener(AUTH_REQUIRED_EVENT, listener);
    },
  );

  it("does not fire the event on unrelated 403 responses", async () => {
    vi.stubGlobal("location", { origin: "http://192.168.0.5:3000" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ error: "cross-site requests are not allowed" }),
      })),
    );

    const listener = vi.fn();
    window.addEventListener(AUTH_REQUIRED_EVENT, listener);

    await getJson("/api/tasks").catch(() => {});
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_REQUIRED_EVENT, listener);
  });
});
