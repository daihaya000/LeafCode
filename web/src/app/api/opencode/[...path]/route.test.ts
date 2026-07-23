import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: vi.fn(() => ({ ok: true, path: "C:\\repo" })),
}));

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
) {
  const headers = contentType ? { "content-type": contentType } : undefined;
  return POST(
    new NextRequest(
      `http://localhost/api/opencode/session/session-1/${operation}?directory=C%3A%5C%5Crepo`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
    ),
    { params: Promise.resolve({ path: ["session", "session-1", operation] }) },
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
    "rejects image parts without an explicit capability before upstream fetch: %s",
    async (operation, body) => {
      const fetchMock = vi.spyOn(globalThis, "fetch");

      const response = await sessionPost(operation, body);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "image input is not supported by the selected model" });
      expect(fetchMock).not.toHaveBeenCalled();
      fetchMock.mockRestore();
    },
  );

  it("rejects JSON image parts with text/plain before upstream fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await sessionPost(
      "prompt_async",
      {
        model: { providerID: "openai", modelID: "uncached-image-model" },
        parts: [{ type: "file", mime: "image/png", url: "data:image/png;base64,AA==" }],
      },
      "text/plain",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "image input is not supported by the selected model" });
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
    await GET(new Request("http://localhost/api/opencode/provider") as never, {
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
    await GET(new Request("http://localhost/api/opencode/provider") as never, {
      params: Promise.resolve({ path: ["provider"] }),
    });
    await GET(new Request("http://localhost/api/opencode/agent") as never, {
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
