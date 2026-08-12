import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  settings: {
    enabled: false,
    opencodeModel: "",
    timeoutMs: 120_000,
  },
  ocServer: vi.fn(),
  OcError: class OcError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

// Keep these unit tests independent from the developer's persisted settings.
vi.mock("./profiles/settings", () => ({
  QWEN_NATIVE_DEFAULTS: { enabled: false, opencodeModel: "", timeoutMs: 120_000 },
  readQwenNativeSettings: () => ({ ...h.settings }),
}));

vi.mock("./oc-server", () => ({
  ocServer: h.ocServer,
  OcError: h.OcError,
}));

import {
  __resetQwenNativeVisionCachesForTest,
  analyzeNativeImages,
  isQwenNativeVisionAvailable,
  nativeImageContext,
  rewriteNativeRequest,
} from "./qwen-native-vision";
import { IMAGE_SEND_SETUP_SLACK_MS } from "./image-send-timeout";

const previousEnabled = process.env.OPENCODE_WEBUI_QWEN_NATIVE;
const previousModel = process.env.OPENCODE_WEBUI_QWEN_MODEL;

beforeEach(() => {
  __resetQwenNativeVisionCachesForTest();
  h.settings = { enabled: false, opencodeModel: "", timeoutMs: 120_000 };
  h.ocServer.mockReset().mockImplementation(async (_dir: string | null, path: string) => {
    if (path === "/session") return { id: "session-1" };
    if (path === "/experimental/tool/ids") return ["bash", "read"];
    if (path.endsWith("/message")) {
      return { parts: [{ type: "text", text: "A dialog is open." }] };
    }
    return {};
  });
});

afterEach(() => {
  if (previousEnabled === undefined) delete process.env.OPENCODE_WEBUI_QWEN_NATIVE;
  else process.env.OPENCODE_WEBUI_QWEN_NATIVE = previousEnabled;
  if (previousModel === undefined) delete process.env.OPENCODE_WEBUI_QWEN_MODEL;
  else process.env.OPENCODE_WEBUI_QWEN_MODEL = previousModel;
});

it("stays unavailable while no OpenCode model is selected", () => {
  process.env.OPENCODE_WEBUI_QWEN_NATIVE = "1";
  expect(isQwenNativeVisionAvailable()).toBe(false);
});

it("becomes available once an OpenCode registered model is selected", () => {
  h.settings = {
    enabled: true,
    opencodeModel: "ollama::qwen2.5vl:7b",
    timeoutMs: 120_000,
  };
  expect(isQwenNativeVisionAvailable()).toBe(true);
});

it("analyzes images with the selected OpenCode model in a throwaway session", async () => {
  h.settings = {
    enabled: true,
    opencodeModel: "ollama::qwen2.5vl:7b",
    timeoutMs: 60_000,
  };

  await expect(
    analyzeNativeImages(
      "What is shown?",
      [{ dataUrl: "data:image/png;base64,AA==", mime: "image/png" }],
      "C:\\repo",
    ),
  ).resolves.toBe("A dialog is open.");

  const messageCall = h.ocServer.mock.calls.find(([, path]) =>
    String(path).endsWith("/message"),
  );
  expect(messageCall?.[0]).toBe("C:\\repo");
  expect(messageCall?.[2]).toMatchObject({
    timeoutMs: 60_000,
    body: {
      model: { providerID: "ollama", modelID: "qwen2.5vl:7b" },
      // agent: "build" is required for the engine to forward image parts.
      agent: "build",
      // Tools are disabled so the analysis session cannot touch the workspace.
      tools: { bash: false, read: false },
    },
  });
  const messageParts = (
    messageCall?.[2] as {
      body: { parts: { type: string }[] };
    }
  ).body.parts;
  expect(messageParts[0]?.type).toBe("text");
  expect(messageParts[1]?.type).toBe("file");
  // The temporary session is deleted afterwards (teardown is fire-and-forget).
  await vi.waitFor(() => {
    expect(
      h.ocServer.mock.calls.some(
        ([, path, init]) =>
          String(path) === "/session/session-1" &&
          (init as { method?: string } | undefined)?.method === "DELETE",
      ),
    ).toBe(true);
  });
});

it("uses setup slack timeout for session create and tool id lookup", async () => {
  h.settings = {
    enabled: true,
    opencodeModel: "ollama::qwen2.5vl:7b",
    timeoutMs: 60_000,
  };

  await analyzeNativeImages("What is shown?", [
    { dataUrl: "data:image/png;base64,AA==", mime: "image/png" },
  ]);

  const sessionCreate = h.ocServer.mock.calls.find(
    ([, path, init]) =>
      path === "/session" &&
      init &&
      typeof init === "object" &&
      (init as { method?: string }).method === "POST",
  );
  const toolIds = h.ocServer.mock.calls.find(
    ([, path]) => path === "/experimental/tool/ids",
  );
  expect(sessionCreate?.[2]).toMatchObject({
    timeoutMs: IMAGE_SEND_SETUP_SLACK_MS,
  });
  expect(toolIds?.[2]).toMatchObject({
    timeoutMs: IMAGE_SEND_SETUP_SLACK_MS,
  });
});

it("caches tool id lookups across consecutive analyses", async () => {
  h.settings = {
    enabled: true,
    opencodeModel: "ollama::qwen2.5vl:7b",
    timeoutMs: 60_000,
  };
  await analyzeNativeImages("a", [
    { dataUrl: "data:image/png;base64,AA==", mime: "image/png" },
  ]);
  await analyzeNativeImages("b", [
    { dataUrl: "data:image/png;base64,AA==", mime: "image/png" },
  ]);
  const toolCalls = h.ocServer.mock.calls.filter(
    ([, path]) => path === "/experimental/tool/ids",
  );
  expect(toolCalls).toHaveLength(1);
});

it("rejects an empty tool id list instead of sending tools:{}", async () => {
  h.settings = {
    enabled: true,
    opencodeModel: "ollama::qwen2.5vl:7b",
    timeoutMs: 60_000,
  };
  h.ocServer.mockImplementation(async (_dir: string | null, path: string) => {
    if (path === "/session") return { id: "session-1" };
    if (path === "/experimental/tool/ids") return [];
    if (path.endsWith("/message")) {
      return { parts: [{ type: "text", text: "should not run" }] };
    }
    return {};
  });

  await expect(
    analyzeNativeImages("x", [
      { dataUrl: "data:image/png;base64,AA==", mime: "image/png" },
    ]),
  ).rejects.toThrow("failed to read tool IDs");

  expect(
    h.ocServer.mock.calls.some(([, path]) => String(path).endsWith("/message")),
  ).toBe(false);
  // Do not cache the empty map — a later successful ids fetch must still work.
  h.ocServer.mockImplementation(async (_dir: string | null, path: string) => {
    if (path === "/session") return { id: "session-2" };
    if (path === "/experimental/tool/ids") return ["bash"];
    if (path.endsWith("/message")) {
      return { parts: [{ type: "text", text: "ok" }] };
    }
    return {};
  });
  await expect(
    analyzeNativeImages("y", [
      { dataUrl: "data:image/png;base64,AA==", mime: "image/png" },
    ]),
  ).resolves.toBe("ok");
  const messageCall = h.ocServer.mock.calls.find(([, path]) =>
    String(path).endsWith("/message"),
  );
  expect(
    (messageCall?.[2] as { body: { tools: Record<string, false> } }).body.tools,
  ).toEqual({ bash: false });
});

it("prefers OPENCODE_WEBUI_QWEN_MODEL over the saved model", async () => {
  h.settings = { enabled: true, opencodeModel: "openai::gpt-4o", timeoutMs: 120_000 };
  process.env.OPENCODE_WEBUI_QWEN_MODEL = "anthropic::claude-vision";

  await analyzeNativeImages("What is shown?", [
    { dataUrl: "data:image/png;base64,AA==", mime: "image/png" },
  ]);

  const messageCall = h.ocServer.mock.calls.find(([, path]) =>
    String(path).endsWith("/message"),
  );
  expect((messageCall?.[2] as { body: { model: unknown } }).body.model).toEqual({
    providerID: "anthropic",
    modelID: "claude-vision",
  });
});

it("rejects analysis while the feature is disabled", async () => {
  await expect(
    analyzeNativeImages("x", [{ dataUrl: "data:image/png;base64,AA==", mime: "image/png" }]),
  ).rejects.toThrow("not enabled");
});

it("rewrites image parts into an untrusted analysis context", async () => {
  h.settings = {
    enabled: true,
    opencodeModel: "ollama::qwen2.5vl:7b",
    timeoutMs: 120_000,
  };
  h.ocServer.mockImplementation(async (_dir: string | null, path: string) => {
    if (path === "/session") return { id: "session-1" };
    if (path === "/experimental/tool/ids") return ["bash"];
    if (path.endsWith("/message")) {
      return { parts: [{ type: "text", text: "Visible text" }] };
    }
    return {};
  });

  const body = await rewriteNativeRequest({
    parts: [
      { type: "text", text: "Read this image" },
      { type: "file", mime: "image/png", url: "data:image/png;base64,AA==" },
    ],
  });

  expect(body.parts).toHaveLength(1);
  expect((body.parts as { text: string }[])[0]?.text).toContain("Visible text");
  expect((body.parts as { text: string }[])[0]?.text).toContain("未信頼データ");
});

it("builds context for image-only prompts", () => {
  expect(nativeImageContext("", "Visible text")).toContain("Visible text");
});

it("disables tools on the analysis session by default", async () => {
  h.settings = {
    enabled: true,
    opencodeModel: "opencode::mimo-v2.5-free",
    timeoutMs: 60_000,
  };
  __resetQwenNativeVisionCachesForTest();

  await analyzeNativeImages("Describe", [
    { dataUrl: "data:image/png;base64,AA==", mime: "image/png" },
  ]);

  const messageCall = h.ocServer.mock.calls.find(([, path]) =>
    String(path).endsWith("/message"),
  );
  const body = (messageCall?.[2] as { body: Record<string, unknown> }).body;
  expect(body).toHaveProperty("tools");
  expect(body.tools).toEqual({ bash: false, read: false });
  expect(body.agent).toBe("build");
});

it("retries without tools only after locking session permissions to deny", async () => {
  h.settings = {
    enabled: true,
    opencodeModel: "ollama::qwen2.5vl:7b",
    timeoutMs: 60_000,
  };
  __resetQwenNativeVisionCachesForTest();
  h.ocServer.mockImplementation(async (_dir: string | null, path: string, init?: { method?: string; body?: { tools?: unknown; permission?: unknown } }) => {
    if (path === "/session") return { id: "session-1" };
    if (path === "/experimental/tool/ids") return ["bash", "read"];
    if (path === "/session/session-1" && init?.method === "PATCH") {
      expect(init.body).toEqual({
        permission: [{ permission: "*", pattern: "*", action: "deny" }],
      });
      return {};
    }
    if (path.endsWith("/message")) {
      if (init?.body && "tools" in init.body) {
        throw new h.OcError("tools not supported", 400);
      }
      return { parts: [{ type: "text", text: "A dialog is open." }] };
    }
    return {};
  });

  await expect(
    analyzeNativeImages("Describe", [
      { dataUrl: "data:image/png;base64,AA==", mime: "image/png" },
    ]),
  ).resolves.toBe("A dialog is open.");

  const messageCalls = h.ocServer.mock.calls.filter(([, path]) =>
    String(path).endsWith("/message"),
  );
  const lockCall = h.ocServer.mock.calls.find(
    ([, path, init]) =>
      path === "/session/session-1" &&
      init &&
      typeof init === "object" &&
      (init as { method?: string }).method === "PATCH",
  );
  expect(messageCalls).toHaveLength(2);
  expect(lockCall).toBeDefined();
  const lockIdx = h.ocServer.mock.calls.indexOf(lockCall!);
  const secondMessageIdx = h.ocServer.mock.calls.indexOf(messageCalls[1]!);
  expect(lockIdx).toBeGreaterThanOrEqual(0);
  expect(lockIdx).toBeLessThan(secondMessageIdx);
  expect(
    (messageCalls[0]?.[2] as { body: Record<string, unknown> }).body,
  ).toHaveProperty("tools");
  expect(
    (messageCalls[1]?.[2] as { body: Record<string, unknown> }).body,
  ).not.toHaveProperty("tools");
});
