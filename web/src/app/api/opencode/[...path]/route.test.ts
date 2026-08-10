import { NextRequest } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: vi.fn((directory: string) => ({
    ok: true as const,
    path: directory,
  })),
}));

// Keep the proxy tests off the real sqlite file: the manual-send hook looks up
// session bindings and would otherwise open the user's actual database.
const goalLoopHook = vi.hoisted(() => ({
  workspaceIds: [] as string[],
  directoryWorkspaceIds: [] as string[],
  outcomes: [] as ("noLoop" | "paused" | "conflict")[],
  calls: [] as { workspaceId: string; sessionId: string }[],
  memoryClaimAvailable: false,
  memoryClaims: [] as { workspaceId: string; sessionId: string }[],
  collaborationBlock: "",
}));

vi.mock("@/lib/db", () => ({
  findWorkspaceIdsBySession: vi.fn(() => goalLoopHook.workspaceIds),
  findWorkspaceIdsBySessionAndDirectory: vi.fn(() => goalLoopHook.directoryWorkspaceIds),
}));

vi.mock("@/lib/memory", () => ({
  claimMemoryInjectionForSession: vi.fn((workspaceId: string, sessionId: string) => {
    if (!goalLoopHook.memoryClaimAvailable) return null;
    goalLoopHook.memoryClaimAvailable = false;
    const claim = { workspaceId, sessionId };
    goalLoopHook.memoryClaims.push(claim);
    return { ...claim, block: "<workspace-memory>\n- [fact] shared\n</workspace-memory>" };
  }),
  releaseMemoryInjectionClaim: vi.fn(),
}));

vi.mock("@/lib/collaboration-context", () => ({
  collaborationContextFor: vi.fn(async () => goalLoopHook.collaborationBlock),
  prependCollaborationContext: vi.fn((body: Record<string, unknown>, block: string) => {
    if (!block || !Array.isArray(body.parts)) return body;
    const part = body.parts.find(
      (item) => item && typeof item === "object" && (item as { type?: unknown }).type === "text",
    ) as { text?: unknown } | undefined;
    if (typeof part?.text !== "string") return body;
    part.text = `${block}\n${part.text}`;
    return body;
  }),
}));

vi.mock("@/lib/goal-loop", () => ({
  pauseGoalLoopForManualSend: vi.fn(async (workspaceId: string, sessionId: string) => {
    goalLoopHook.calls.push({ workspaceId, sessionId });
    return goalLoopHook.outcomes.shift() ?? "noLoop";
  }),
}));

// The proxy arms the server-side hang watchdog for every send it forwards.
// See docs/specs/hang-watchdog-server-side.md.
const hangWatch = vi.hoisted(() => ({
  armed: [] as { sessionId: string; directory: string; requestPath: string; body: unknown; timeoutMs: number }[],
  disarmed: [] as string[],
}));

vi.mock("@/lib/hang-watchdog", () => ({
  armHangWatch: vi.fn((input: (typeof hangWatch.armed)[number]) => {
    hangWatch.armed.push(input);
  }),
  disarmHangWatch: vi.fn((sessionId: string) => {
    hangWatch.disarmed.push(sessionId);
  }),
}));

import { assertAllowedDirectory } from "@/lib/allowlist";
import { SSE_UPSTREAM_CONNECT_TIMEOUT_MS } from "@/lib/sse-health";
import { GET, POST } from "./route";

beforeEach(() => {
  goalLoopHook.workspaceIds = [];
  goalLoopHook.directoryWorkspaceIds = [];
  goalLoopHook.outcomes = [];
  goalLoopHook.calls = [];
  goalLoopHook.memoryClaimAvailable = false;
  goalLoopHook.memoryClaims = [];
  goalLoopHook.collaborationBlock = "";
  hangWatch.armed = [];
  hangWatch.disarmed = [];
});

function post(body: string, contentType = "application/json") {
  return POST(
    new NextRequest(
      "http://localhost/api/opencode/session/session-1/prompt_async?directory=C%3A%5C%5Crepo",
      {
        method: "POST",
        headers: { host: "127.0.0.1:3000", "content-type": contentType },
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
        headers: { host: "127.0.0.1:3000", ...headers },
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
        headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
    { params: Promise.resolve({ path: pathSegments }) },
  );
}

describe("POST /api/opencode/session/:id/prompt_async variant validation", () => {
  it("injects shared memory only for the matching workspace directory", async () => {
    goalLoopHook.directoryWorkspaceIds = ["ws-1"];
    goalLoopHook.memoryClaimAvailable = true;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const first = await post(JSON.stringify({ parts: [{ type: "text", text: "hello" }] }));
    expect(first.status).toBe(200);
    const firstBody = JSON.parse(
      new TextDecoder().decode(fetchMock.mock.calls[0]![1]?.body as ArrayBuffer),
    ) as { parts: { text: string }[] };
    expect(firstBody.parts[0]?.text).toContain("shared");

    const second = await post(JSON.stringify({ parts: [{ type: "text", text: "again" }] }));
    expect(second.status).toBe(200);
    const secondBody = JSON.parse(
      new TextDecoder().decode(fetchMock.mock.calls[1]![1]?.body as ArrayBuffer),
    ) as { parts: { text: string }[] };
    expect(secondBody.parts[0]?.text).toBe("again");
    expect(goalLoopHook.memoryClaims).toEqual([{ workspaceId: "ws-1", sessionId: "session-1" }]);
    fetchMock.mockRestore();
  });

  it("does not inject memory when the session directory is ambiguous", async () => {
    goalLoopHook.directoryWorkspaceIds = ["ws-1", "ws-2"];
    goalLoopHook.memoryClaimAvailable = true;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await post(JSON.stringify({ parts: [{ type: "text", text: "hello" }] }));
    expect(response.status).toBe(200);
    const body = JSON.parse(
      new TextDecoder().decode(fetchMock.mock.calls[0]![1]?.body as ArrayBuffer),
    ) as { parts: { text: string }[] };
    expect(body.parts[0]?.text).toBe("hello");
    expect(goalLoopHook.memoryClaims).toHaveLength(0);
    fetchMock.mockRestore();
  });

  it("injects live collaboration context on every prompt", async () => {
    goalLoopHook.directoryWorkspaceIds = ["ws-1"];
    goalLoopHook.collaborationBlock =
      "<collaboration-context>\n- peer: busy; files: src/a.ts\n</collaboration-context>";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await post(JSON.stringify({ parts: [{ type: "text", text: "hello" }] }));

    expect(response.status).toBe(200);
    const body = JSON.parse(
      new TextDecoder().decode(fetchMock.mock.calls[0]![1]?.body as ArrayBuffer),
    ) as { parts: { text: string }[] };
    expect(body.parts[0]?.text).toContain("peer: busy; files: src/a.ts");
    expect(body.parts[0]?.text).toContain("hello");
    fetchMock.mockRestore();
  });

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
      // The live capability query and the Qwen MCP status query happened;
      // the write was never forwarded.
      expect(fetchMock).toHaveBeenCalledTimes(2);
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
    // The capability query and the fail-closed Qwen MCP status query happened;
    // the write was never forwarded.
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("rejects oversized v2 prompt.files images on api/session/.../prompt", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const hugeB64 = "A".repeat(Math.ceil((10 * 1024 * 1024 * 4) / 3) + 4);
    const response = await sessionWritePost(
      ["api", "session", "session-1", "prompt"],
      {
        model: { providerID: "openai", modelID: "vision" },
        prompt: {
          text: "look",
          files: [
            {
              mime: "image/png",
              uri: `data:image/png;base64,${hugeB64}`,
            },
          ],
        },
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid files" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("rejects unsupported models for v2 prompt.files images", async () => {
    const directory = "C:\\\\repo\\\\v2-files";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse({
          all: [{ id: "openai", models: {} }],
          connected: ["openai"],
        }),
      );

    const response = await sessionWritePost(
      ["api", "session", "session-1", "prompt"],
      {
        model: { providerID: "openai", modelID: "text-only" },
        prompt: {
          text: "look",
          files: [
            {
              mime: "image/png",
              uri: "data:image/png;base64,AA==",
            },
          ],
        },
      },
      directory,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "image input is not supported by the selected model",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });

  it("rewrites image parts through the connected Qwen MCP for a text-only model", async () => {
    const directory = "C:\\repo\\qwen-mm-fallback";
    const previousAppData = process.env.APPDATA;
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-qwen-route-"));
    process.env.APPDATA = appData;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/provider") {
        return Promise.resolve(jsonResponse({
          all: [{
            id: "text-provider",
            models: { text: { capabilities: { input: { image: false } } } },
          }],
          connected: ["text-provider"],
        }));
      }
      if (pathname === "/mcp") {
        return Promise.resolve(jsonResponse({
          "qwen-mm-plugins-core": { status: "connected" },
        }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    try {
      const response = await sessionPost(
        "prompt_async",
        {
          model: { providerID: "text-provider", modelID: "text" },
          parts: [
            { type: "text", text: "画像を説明して" },
            { type: "file", mime: "image/png", url: "data:image/png;base64,AA==" },
          ],
        },
        "application/json",
        directory,
      );

      expect(response.status).toBe(200);
      const upstreamInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
      const upstreamBody = await new Response(upstreamInit?.body).json() as {
        parts: { type: string; text?: string }[];
      };
      expect(upstreamBody.parts).toHaveLength(1);
      expect(upstreamBody.parts[0]?.type).toBe("text");
      expect(upstreamBody.parts[0]?.text).toContain("vision_chat");
      expect(upstreamBody.parts[0]?.text).toContain("画像を説明して");
    } finally {
      fetchMock.mockRestore();
      fs.rmSync(appData, { recursive: true, force: true });
      if (previousAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = previousAppData;
    }
  });

  it("analyzes image parts natively before forwarding to a text-only model", async () => {
    const directory = "C:\\repo\\qwen-native";
    const previousKey = process.env.DASHSCOPE_API_KEY;
    const previousBaseUrl = process.env.DASHSCOPE_BASE_URL;
    process.env.DASHSCOPE_API_KEY = "dashscope-secret";
    process.env.DASHSCOPE_BASE_URL = "https://dashscope.example/v1";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(String(input));
      if (url.hostname === "dashscope.example") {
        return Promise.resolve(jsonResponse({
          choices: [{ message: { content: "Native visual analysis" } }],
        }));
      }
      if (url.pathname === "/provider") {
        return Promise.resolve(jsonResponse({
          all: [{
            id: "text-provider",
            models: { text: { capabilities: { input: { image: false } } } },
          }],
          connected: ["text-provider"],
        }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    try {
      const response = await sessionPost(
        "prompt_async",
        {
          model: { providerID: "text-provider", modelID: "text" },
          parts: [
            { type: "text", text: "画像を説明して" },
            { type: "file", mime: "image/png", url: "data:image/png;base64,AA==" },
          ],
        },
        "application/json",
        directory,
      );

      expect(response.status).toBe(200);
      const upstreamCall = fetchMock.mock.calls.find(([input]) =>
        new URL(String(input)).pathname.endsWith("/prompt_async"),
      );
      const upstreamBody = await new Response(upstreamCall?.[1]?.body).json() as {
        parts: { type: string; text?: string }[];
      };
      expect(upstreamBody.parts).toHaveLength(1);
      expect(upstreamBody.parts[0]?.text).toContain("Native visual analysis");
      expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname === "/mcp")).toBe(false);
    } finally {
      fetchMock.mockRestore();
      if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY;
      else process.env.DASHSCOPE_API_KEY = previousKey;
      if (previousBaseUrl === undefined) delete process.env.DASHSCOPE_BASE_URL;
      else process.env.DASHSCOPE_BASE_URL = previousBaseUrl;
    }
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
    await GET(new Request("http://localhost/api/opencode/provider?directory=C%3A%5C%5Crepo", { headers: { host: "127.0.0.1:3000" } }) as never, {
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
    await GET(new Request("http://localhost/api/opencode/provider?directory=C%3A%5C%5Crepo", { headers: { host: "127.0.0.1:3000" } }) as never, {
      params: Promise.resolve({ path: ["provider"] }),
    });
    await GET(new Request("http://localhost/api/opencode/agent?directory=C%3A%5C%5Crepo", { headers: { host: "127.0.0.1:3000" } }) as never, {
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    await GET(new Request("http://localhost/api/opencode/provider?directory=C%3A%5C%5Crepo", { headers: { host: "127.0.0.1:3000" } }) as never, {
      params: Promise.resolve({ path: ["provider"] }),
    });
    await GET(new Request("http://localhost/api/opencode/agent?directory=C%3A%5C%5Crepo", { headers: { host: "127.0.0.1:3000" } }) as never, {
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
    await GET(new Request("http://localhost/api/opencode/provider?directory=C%3A%5C%5Crepo", { headers: { host: "127.0.0.1:3000" } }) as never, {
      params: Promise.resolve({ path: ["provider"] }),
    });
    await GET(new Request("http://localhost/api/opencode/agent?directory=C%3A%5C%5Crepo", { headers: { host: "127.0.0.1:3000" } }) as never, {
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    await GET(new Request("http://localhost/api/opencode/provider", { headers: { host: "127.0.0.1:3000" } }) as never, {
      params: Promise.resolve({ path: ["provider"] }),
    });
    fetchMock.mockClear();

    // Step 2: an image prompt for a *different, still-unseeded* directory.
    const response = await POST(
      new NextRequest(
        `http://localhost/api/opencode/session/session-1/prompt_async?directory=${encodeURIComponent(directory)}`,
        {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
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
      new Request(`http://localhost/api/opencode${_pathname}`, { headers: { host: "127.0.0.1:3000" } }) as never,
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
    expect(body.error).toMatch(/290秒/);
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
      new NextRequest("http://localhost/api/opencode/event", { headers: { host: "127.0.0.1:3000" } }) as never,
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
      { headers: { host: "127.0.0.1:3000" } },
      ) as never,
      { params: Promise.resolve({ path: ["event"] }) },
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect((init as RequestInit | undefined)?.signal).toBeInstanceOf(AbortSignal);
    fetchMock.mockRestore();
  });

  it("returns 504 when the engine never sends SSE response headers", async () => {
    // A saturated engine used to hold this request open for the whole
    // maxDuration window, leaving the browser's EventSource stuck in CONNECTING
    // with no error event to reconnect from.
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(
          (_input, init) =>
            new Promise((_resolve, reject) => {
              const signal = (init as RequestInit | undefined)?.signal;
              signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
            }),
        );
      const pending = GET(
        new NextRequest(
          "http://localhost/api/opencode/event?directory=C%3A%5C%5Crepo",
        { headers: { host: "127.0.0.1:3000" } },
        ) as never,
        { params: Promise.resolve({ path: ["event"] }) },
      );
      await vi.advanceTimersByTimeAsync(SSE_UPSTREAM_CONNECT_TIMEOUT_MS + 10);
      const response = await pending;
      expect(response.status).toBe(504);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("タイムアウト");
      fetchMock.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not time out an SSE stream once headers have arrived", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(new ReadableStream(), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
      const response = await GET(
        new NextRequest(
          "http://localhost/api/opencode/event?directory=C%3A%5C%5Crepo",
        { headers: { host: "127.0.0.1:3000" } },
        ) as never,
        { params: Promise.resolve({ path: ["event"] }) },
      );
      expect(response.status).toBe(200);
      const [, init] = fetchMock.mock.calls[0] ?? [];
      const signal = (init as RequestInit | undefined)?.signal;
      // The connect timer is cleared on headers, so advancing well past it must
      // leave the established stream untouched.
      await vi.advanceTimersByTimeAsync(SSE_UPSTREAM_CONNECT_TIMEOUT_MS * 3);
      expect(signal?.aborted).toBe(false);
      fetchMock.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("session permission writes", () => {
  it("rejects session create bodies that include permission", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await POST(
      new NextRequest(
        "http://localhost/api/opencode/session?directory=C%3A%5C%5Crepo",
        {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            title: "x",
            permission: [{ permission: "bash", pattern: "*", action: "allow" }],
          }),
        },
      ),
      { params: Promise.resolve({ path: ["session"] }) },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("subagent-permission"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("rejects session PATCH bodies that include permission", async () => {
    const { PATCH } = await import("./route");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await PATCH(
      new NextRequest(
        "http://localhost/api/opencode/session/session-1?directory=C%3A%5C%5Crepo",
        {
          method: "PATCH",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            permission: [{ permission: "edit", pattern: "*", action: "allow" }],
          }),
        },
      ),
      { params: Promise.resolve({ path: ["session", "session-1"] }) },
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});

describe("non-Latin-1 directory handling", () => {
  it("forwards allowlist-resolved path instead of a relative client directory", async () => {
    vi.mocked(assertAllowedDirectory).mockReturnValueOnce({
      ok: true,
      path: "C:\\repo",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ ok: true }));

    const response = await GET(
      new NextRequest(
        "http://localhost/api/opencode/session?directory=.",
      { headers: { host: "127.0.0.1:3000" } },
      ) as never,
      { params: Promise.resolve({ path: ["session"] }) },
    );

    expect(response.status).toBe(200);
    expect(assertAllowedDirectory).toHaveBeenCalledWith(".");
    const [upstreamUrl, upstreamInit] = fetchMock.mock.calls[0] ?? [];
    const url = new URL(String(upstreamUrl));
    expect(url.searchParams.get("directory")).toBe("C:\\repo");
    const headers = new Headers(
      (upstreamInit as RequestInit | undefined)?.headers as HeadersInit | undefined,
    );
    expect(headers.get("x-opencode-directory")).toBe("C:\\repo");
    fetchMock.mockRestore();
    vi.mocked(assertAllowedDirectory).mockReset();
  });

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
      { headers: { host: "127.0.0.1:3000" } },
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
      { headers: { host: "127.0.0.1:3000" } },
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

describe("manual send pauses a live goal loop (docs/specs/goal-loop.md 是正 D)", () => {
  it("pauses every workspace bound to the session before forwarding a prompt", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    goalLoopHook.workspaceIds = ["ws-1", "ws-2"];
    goalLoopHook.outcomes = ["paused", "noLoop"];

    const response = await sessionPost("prompt_async", {
      parts: [{ type: "text", text: "hi" }],
    });

    expect(response.status).toBe(200);
    expect(goalLoopHook.calls).toEqual([
      { workspaceId: "ws-1", sessionId: "session-1" },
      { workspaceId: "ws-2", sessionId: "session-1" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it("pauses before a /command send too", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    goalLoopHook.workspaceIds = ["ws-1"];
    goalLoopHook.outcomes = ["paused"];

    const response = await sessionPost("command", { command: "loop" });

    expect(response.status).toBe(200);
    expect(goalLoopHook.calls).toHaveLength(1);
    fetchMock.mockRestore();
  });

  it("returns 409 without forwarding when the loop cannot be paused", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    goalLoopHook.workspaceIds = ["ws-1"];
    goalLoopHook.outcomes = ["conflict"];

    const response = await sessionPost("prompt_async", {
      parts: [{ type: "text", text: "hi" }],
    });

    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("does not consult the goal loop for unrelated session reads", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify([])));

    const response = await GET(
      new NextRequest(
        "http://localhost/api/opencode/session/session-1/message?directory=C%3A%5C%5Crepo",
      { headers: { host: "127.0.0.1:3000" } },
      ) as never,
      { params: Promise.resolve({ path: ["session", "session-1", "message"] }) },
    );

    expect(response.status).toBe(200);
    expect(goalLoopHook.calls).toEqual([]);
    fetchMock.mockRestore();
  });
});

describe("arms the server-side hang watchdog (docs/specs/hang-watchdog-server-side.md)", () => {
  it("arms the watch for a forwarded prompt_async", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ ok: true }));

    const response = await sessionPost("prompt_async", {
      parts: [{ type: "text", text: "go" }],
      agent: "build",
    });

    expect(response.status).toBe(200);
    expect(hangWatch.armed).toHaveLength(1);
    expect(hangWatch.armed[0]).toMatchObject({
      sessionId: "session-1",
      directory: "C:\\\\repo",
      requestPath: "/session/session-1/prompt_async",
      body: { parts: [{ type: "text", text: "go" }], agent: "build" },
    });
    expect(hangWatch.disarmed).toEqual([]);
    fetchMock.mockRestore();
  });

  it("arms the watch for a synchronous command with the long-running timeout", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ ok: true }));

    await sessionPost("command", { command: "commit", arguments: "" });

    expect(hangWatch.armed).toHaveLength(1);
    expect(hangWatch.armed[0].requestPath).toBe("/session/session-1/command");
    expect(hangWatch.armed[0].timeoutMs).toBe(290_000);
    fetchMock.mockRestore();
  });

  it("disarms the watch when the engine rejects the send", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ error: "unknown session" }, 404));

    const response = await sessionPost("prompt_async", {
      parts: [{ type: "text", text: "go" }],
    });

    expect(response.status).toBe(404);
    expect(hangWatch.armed).toHaveLength(1);
    expect(hangWatch.disarmed).toEqual(["session-1"]);
    fetchMock.mockRestore();
  });

  it("disarms the watch when the engine is unreachable", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("connect ECONNREFUSED"));

    const response = await sessionPost("prompt_async", {
      parts: [{ type: "text", text: "go" }],
    });

    expect(response.status).toBe(503);
    expect(hangWatch.disarmed).toEqual(["session-1"]);
    fetchMock.mockRestore();
  });

  it("does not arm a watch for session reads", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse([]));

    await GET(
      new NextRequest(
        "http://localhost/api/opencode/session/session-1/message?directory=C%3A%5C%5Crepo",
      { headers: { host: "127.0.0.1:3000" } },
      ) as never,
      { params: Promise.resolve({ path: ["session", "session-1", "message"] }) },
    );

    expect(hangWatch.armed).toEqual([]);
    fetchMock.mockRestore();
  });
});
