import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: vi.fn(() => ({ ok: true, path: "C:\\repo" })),
}));

import { assertAllowedDirectory } from "@/lib/allowlist";
import { GET, POST } from "./route";

function post(body: string, contentType = "application/json") {
  return POST(
    new NextRequest(
      "http://localhost/api/opencode/session/session-1/prompt_async?directory=C%3A%5C%5Crepo",
      {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      },
    ),
    { params: Promise.resolve({ path: ["session", "session-1", "prompt_async"] }) },
  );
}

function sessionPost(
  operation: "prompt_async" | "command",
  body: Record<string, unknown>,
  contentType = "application/json",
  // Matches the literal "C%3A%5C%5Crepo" (two backslashes) used by the other
  // GET /provider,/agent helpers below so the per-directory cache key lines up.
  directory = "C:\\\\repo",
) {
  const headers = contentType ? { "content-type": contentType } : undefined;
  return POST(
    new NextRequest(
      `http://localhost/api/opencode/session/session-1/${operation}?directory=${encodeURIComponent(directory)}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
    ),
    { params: Promise.resolve({ path: ["session", "session-1", operation] }) },
  );
}

function sessionWritePost(
  pathSegments: string[],
  body: Record<string, unknown>,
  directory = "C:\\\\repo",
) {
  return POST(
    new NextRequest(
      `http://localhost/api/opencode/${pathSegments.join("/")}?directory=${encodeURIComponent(directory)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
    { params: Promise.resolve({ path: pathSegments }) },
  );
}

describe("POST /api/opencode/session/:id/prompt_async variant validation", () => {
  it("returns 400 without calling upstream for an invalid variant", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    const response = await post(JSON.stringify({ variant: "turbo" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid variant" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("forwards a high variant body to upstream", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const body = JSON.stringify({ model: { modelID: "model-1" }, variant: "high" });

    const response = await post(body);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(await new Response(init?.body).text()).toBe(body);
    fetchMock.mockRestore();
  });

  it("forwards a medium variant body to upstream", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const body = JSON.stringify({
      model: { modelID: "model-1" },
      variant: "medium",
    });

    const response = await post(body);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(await new Response(init?.body).text()).toBe(body);
    fetchMock.mockRestore();
  });
});

describe("POST session image capability validation", () => {
  it.each([
    ["prompt_async", {
      model: { providerID: "openai", modelID: "uncached-image-model" },
      parts: [{ type: "file", mime: "image/png", url: "data:image/png;base64,AA==" }],
    }],
    ["command", {
      command: "review",
      arguments: "",
      model: "openai/uncached-image-model",
      parts: [{ type: "file", mime: "image/png", url: "data:image/png;base64,AA==" }],
    }],
  ] as const)(
    "live-queries an unseeded directory's /provider and still rejects an unsupported model before upstream fetch: %s",
    async (operation, body) => {
      // A directory unique to this test case, so an earlier test's cache
      // entry for a different directory cannot mask a missing live query.
      const directory = `C:\\repo\\unseeded-${operation}`;
      // No cache entry exists for this directory yet, so supportsImageInput
      // must fall back to a live, directory-scoped /provider query. That
      // live response has no matching model, so the request is still
      // rejected without ever reaching the write endpoint.
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          jsonResponse({
            all: [{ id: "openai", models: {} }],
            connected: ["openai"],
          }),
        );

      const response = await sessionPost(operation, body, "application/json", directory);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "image input is not supported by the selected model" });
      // Only the live capability query happened — never the forwarded write.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [providerUrl] = fetchMock.mock.calls[0] ?? [];
      expect(new URL(String(providerUrl)).pathname).toBe("/provider");
      fetchMock.mockRestore();
    },
  );

  it("rejects JSON image parts with text/plain before upstream fetch", async () => {
    const directory = "C:\\repo\\unseeded-text-plain";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse({
          all: [{ id: "openai", models: {} }],
          connected: ["openai"],
        }),
      );

    const response = await sessionPost(
      "prompt_async",
      {
        model: { providerID: "openai", modelID: "uncached-image-model" },
        parts: [{ type: "file", mime: "image/png", url: "data:image/png;base64,AA==" }],
      },
      "text/plain",
      directory,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "image input is not supported by the selected model" });
    // Only the live capability query happened — never the forwarded write.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [providerUrl] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(String(providerUrl)).pathname).toBe("/provider");
    fetchMock.mockRestore();
  });

  it("rejects oversized image payloads before capability lookup", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const hugeB64 = "A".repeat(Math.ceil((10 * 1024 * 1024 * 4) / 3) + 4);
    const response = await sessionPost("prompt_async", {
      model: { providerID: "openai", modelID: "vision" },
      parts: [
        {
          type: "file",
          mime: "image/png",
          url: `data:image/png;base64,${hugeB64}`,
        },
      ],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid files" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("rejects more than 10 image parts before capability lookup", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const parts = Array.from({ length: 11 }, (_, i) => ({
      type: "file",
      mime: "image/png",
      url: "data:image/png;base64,AA==",
      filename: `n${i}.png`,
    }));
    const response = await sessionPost("prompt_async", {
      model: { providerID: "openai", modelID: "vision" },
      parts,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid files" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it.each([
    ["session/.../message", ["session", "session-1", "message"]],
    ["session/.../prompt", ["session", "session-1", "prompt"]],
    ["api/session/.../prompt", ["api", "session", "session-1", "prompt"]],
  ])("rejects oversized images on %s before forwarding", async (_label, segments) => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const hugeB64 = "A".repeat(Math.ceil((10 * 1024 * 1024 * 4) / 3) + 4);
    const response = await sessionWritePost(segments, {
      model: { providerID: "openai", modelID: "vision" },
      parts: [
        {
          type: "file",
          mime: "image/png",
          url: `data:image/png;base64,${hugeB64}`,
        },
      ],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid files" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("forwards image parts after the provider cache confirms capability", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          all: [{
            id: "cache-provider",
            models: {
              vision: { capabilities: { input: { image: true } } },
            },
          }],
          connected: ["cache-provider"],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    // Cache is now per-directory, so include directory in the GET request
    await GET(new Request("http://localhost/api/opencode/provider?directory=C%3A%5C%5Crepo") as never, {
      params: Promise.resolve({ path: ["provider"] }),
    });
    fetchMock.mockClear();

    const response = await sessionPost("prompt_async", {
      model: { providerID: "cache-provider", modelID: "vision" },
      parts: [{ type: "file", mime: "image/png", url: "data:image/png;base64,AA==" }],
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it("uses the cached agent model instead of a manually supplied image model", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/provider") {
        return Promise.resolve(
          jsonResponse({
            all: [{
              id: "agent-provider",
              models: {
                vision: { capabilities: { input: { image: true } } },
                text: { capabilities: { input: { image: false } } },
              },
            }],
            connected: ["agent-provider"],
          }),
        );
      }
      return Promise.resolve(
        jsonResponse([
          {
            name: "text-agent",
            model: { providerID: "agent-provider", modelID: "text" },
          },
        ]),
      );
    });
    // Cache is now per-directory, so include directory in the GET requests
    await GET(new Request("http://localhost/api/opencode/provider?directory=C%3A%5C%5Crepo") as never, {
      params: Promise.resolve({ path: ["provider"] }),
    });
    await GET(new Request("http://localhost/api/opencode/agent?directory=C%3A%5C%5Crepo") as never, {
      params: Promise.resolve({ path: ["agent"] }),
    });
    fetchMock.mockClear();

    const response = await sessionPost("command", {
      command: "review",
      arguments: "",
      agent: "text-agent",
      model: "agent-provider/vision",
      parts: [{ type: "file", mime: "image/png", url: "data:image/png;base64,AA==" }],
    });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("falls back to the request model when the selected agent has no configured model", async () => {
    // The agent exists but carries no per-agent model, so image capability
    // must be decided by the model explicitly selected in the request rather
    // than fail-closing. The request model is image-capable, so it forwards.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/provider") {
        return Promise.resolve(
          jsonResponse({
            all: [{
              id: "fallback-provider",
              models: {
                vision: { capabilities: { input: { image: true } } },
              },
            }],
            connected: ["fallback-provider"],
          }),
        );
      }
      if (pathname === "/agent") {
        return Promise.resolve(jsonResponse([{ name: "modelless-agent" }]));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    await GET(new Request("http://localhost/api/opencode/provider?directory=C%3A%5C%5Crepo") as never, {
      params: Promise.resolve({ path: ["provider"] }),
    });
    await GET(new Request("http://localhost/api/opencode/agent?directory=C%3A%5C%5Crepo") as never, {
      params: Promise.resolve({ path: ["agent"] }),
    });
    fetchMock.mockClear();

    const response = await sessionPost("prompt_async", {
      agent: "modelless-agent",
      model: { providerID: "fallback-provider", modelID: "vision" },
      parts: [{ type: "file", mime: "image/png", url: "data:image/png;base64,AA==" }],
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [forwardedUrl] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(String(forwardedUrl)).pathname).toBe("/session/session-1/prompt_async");
    fetchMock.mockRestore();
  });

  it("rejects an agent without a model when the request model lacks image capability", async () => {
    // With no per-agent model the request model decides capability. This
    // request model is not image-capable, so the write is still rejected.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/provider") {
        return Promise.resolve(
          jsonResponse({
            all: [{
              id: "textonly-provider",
              models: {
                text: { capabilities: { input: { image: false } } },
              },
            }],
            connected: ["textonly-provider"],
          }),
        );
      }
      if (pathname === "/agent") {
        return Promise.resolve(jsonResponse([{ name: "modelless-agent" }]));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    await GET(new Request("http://localhost/api/opencode/provider?directory=C%3A%5C%5Crepo") as never, {
      params: Promise.resolve({ path: ["provider"] }),
    });
    await GET(new Request("http://localhost/api/opencode/agent?directory=C%3A%5C%5Crepo") as never, {
      params: Promise.resolve({ path: ["agent"] }),
    });
    fetchMock.mockClear();

    const response = await sessionPost("prompt_async", {
      agent: "modelless-agent",
      model: { providerID: "textonly-provider", modelID: "text" },
      parts: [{ type: "file", mime: "image/png", url: "data:image/png;base64,AA==" }],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "image input is not supported by the selected model" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("live-queries a directory-scoped /provider fallback after only a directory-less provider fetch was cached (regression)", async () => {
    // A directory-less GET /provider (allowed for the composer's initial
    // model-list fetch) never seeds the per-directory cache — see
    // cacheCapabilityMetadata's `if (!directory) return`. Previously this
    // left supportsImageInput() permanently fail-closed for that directory
    // even for an image-capable model, because there was no live fallback.
    const directory = "C:\\repo\\fresh-project";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/provider") {
        return Promise.resolve(
          jsonResponse({
            all: [{
              id: "fresh-provider",
              models: {
                vision: { capabilities: { input: { image: true } } },
              },
            }],
            connected: ["fresh-provider"],
          }),
        );
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    // Step 1: directory-less provider fetch (as the composer performs on
    // load before any project directory is known). This must not seed the
    // per-directory cache for `directory` below.
    await GET(new Request("http://localhost/api/opencode/provider") as never, {
      params: Promise.resolve({ path: ["provider"] }),
    });
    fetchMock.mockClear();

    // Step 2: an image prompt for a *different, still-unseeded* directory.
    const response = await POST(
      new NextRequest(
        `http://localhost/api/opencode/session/session-1/prompt_async?directory=${encodeURIComponent(directory)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: { providerID: "fresh-provider", modelID: "vision" },
            parts: [{ type: "file", mime: "image/png", url: "data:image/png;base64,AA==" }],
          }),
        },
      ),
      { params: Promise.resolve({ path: ["session", "session-1", "prompt_async"] }) },
    );

    expect(response.status).toBe(200);
    // One live, directory-scoped capability query + one forwarded prompt call.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [providerUrl, providerInit] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(String(providerUrl)).pathname).toBe("/provider");
    expect(
      (providerInit as { headers?: Record<string, string> } | undefined)?.headers?.[
        "x-opencode-directory"
      ],
    ).toBe(directory);
    fetchMock.mockRestore();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GET provider/config responses", () => {
  it.each([
    [
      "/provider",
      ["provider"],
      { all: [{ id: "openai", key: "sk-secret123" }] },
      ["all", 0, "key"],
      "sk-s…********",
    ],
    [
      "/provider/openai",
      ["provider", "openai"],
      { id: "openai", key: "sk-subpath" },
      ["key"],
      "sk-s…********",
    ],
    [
      "/api/provider",
      ["api", "provider"],
      { all: [{ id: "openai", key: "sk-secret123" }] },
      ["all", 0, "key"],
      "sk-s…********",
    ],
    [
      "/config/providers",
      ["config", "providers"],
      { providers: [{ id: "openai", key: "sk-leaked" }] },
      ["providers", 0, "key"],
      "sk-l…********",
    ],
    [
      "/global/config",
      ["global", "config"],
      { providers: [{ id: "openai", options: { apiKey: "sk-global" } }] },
      ["providers", 0, "options", "apiKey"],
      "sk-g…********",
    ],
  ])("masks secrets on GET %s", async (_pathname, path, responseBody, bodyPath, expected) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(responseBody));
    const response = await GET(
      new Request(`http://localhost/api/opencode${_pathname}`) as never,
      { params: Promise.resolve({ path }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    let value: unknown = body;
    for (const key of bodyPath) value = (value as Record<string, unknown>)[key];
    expect(value).toBe(expected);
    expect(JSON.stringify(body)).not.toContain("sk-secret123");
    expect(JSON.stringify(body)).not.toContain("sk-leaked");
    expect(JSON.stringify(body)).not.toContain("sk-global");
    fetchMock.mockRestore();
  });
});

describe("upstream timeout handling", () => {
  it("gives synchronous session.command a long-running timeout", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_input, init) => {
        capturedSignal = (init as RequestInit | undefined)?.signal ?? undefined;
        return Promise.resolve(jsonResponse({ ok: true }));
      });

    const response = await sessionPost("command", {
      command: "loop",
      arguments: "2m",
    });

    expect(response.status).toBe(200);
    // A signal must be attached (not the bare SSE no-timeout path) and it must
    // not be already aborted at fetch time.
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);
    fetchMock.mockRestore();
  });

  it("converts an AbortSignal.timeout DOMException to a friendly 408", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(
        new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      );

    const response = await sessionPost("command", {
      command: "loop",
      arguments: "2m",
    });

    expect(response.status).toBe(408);
    const body = (await response.json()) as { error: string; detail?: string };
    expect(body.error).toMatch(/タイムアウト/);
    expect(body.error).not.toContain("The operation was aborted");
    fetchMock.mockRestore();
  });

  it("still reports non-timeout upstream failures as 503", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("ECONNREFUSED"));

    const response = await sessionPost("command", {
      command: "loop",
      arguments: "2m",
    });

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("OpenCode engine unavailable");
    fetchMock.mockRestore();
  });
});

describe("directory requirement for /event", () => {
  it("rejects GET /event without directory", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await GET(
      new NextRequest("http://localhost/api/opencode/event") as never,
      { params: Promise.resolve({ path: ["event"] }) },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/directory/i);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("forwards GET /event with directory and client abort signal", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("data: hi\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    const response = await GET(
      new NextRequest(
        "http://localhost/api/opencode/event?directory=C%3A%5C%5Crepo",
      ) as never,
      { params: Promise.resolve({ path: ["event"] }) },
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect((init as RequestInit | undefined)?.signal).toBeInstanceOf(AbortSignal);
    fetchMock.mockRestore();
  });
});

describe("non-Latin-1 directory handling", () => {
  it("forwards a Japanese directory via query and omits the header without throwing", async () => {
    const directory = "C:\\Users\\会議\\project";
    vi.mocked(assertAllowedDirectory).mockReturnValueOnce({
      ok: true,
      path: directory,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ ok: true }));

    const response = await GET(
      new NextRequest(
        `http://localhost/api/opencode/session?directory=${encodeURIComponent(directory)}`,
      ) as never,
      { params: Promise.resolve({ path: ["session"] }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [upstreamUrl, upstreamInit] = fetchMock.mock.calls[0] ?? [];
    const url = new URL(String(upstreamUrl));
    // The validated directory must be present on the upstream URL query.
    expect(url.searchParams.get("directory")).toBe(directory);
    // The raw serialized query must be percent-encoded (no raw multibyte).
    expect(url.search).not.toContain("会議");
    // The header must NOT be set for non-Latin-1 values.
    const headers = new Headers(
      (upstreamInit as RequestInit | undefined)?.headers as HeadersInit | undefined,
    );
    expect(headers.get("x-opencode-directory")).toBeNull();
    fetchMock.mockRestore();
    vi.mocked(assertAllowedDirectory).mockReset();
  });

  it("attaches the header and the query for an ASCII directory (regression)", async () => {
    const directory = "C:\\repo";
    vi.mocked(assertAllowedDirectory).mockReturnValueOnce({
      ok: true,
      path: directory,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ ok: true }));

    const response = await GET(
      new NextRequest(
        `http://localhost/api/opencode/session?directory=${encodeURIComponent(directory)}`,
      ) as never,
      { params: Promise.resolve({ path: ["session"] }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [upstreamUrl, upstreamInit] = fetchMock.mock.calls[0] ?? [];
    const url = new URL(String(upstreamUrl));
    expect(url.searchParams.get("directory")).toBe(directory);
    const headers = new Headers(
      (upstreamInit as RequestInit | undefined)?.headers as HeadersInit | undefined,
    );
    expect(headers.get("x-opencode-directory")).toBe(directory);
    fetchMock.mockRestore();
    vi.mocked(assertAllowedDirectory).mockReset();
  });
});
