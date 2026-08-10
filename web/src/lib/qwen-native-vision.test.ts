import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  settings: {
    enabled: false,
    opencodeModel: "",
    timeoutMs: 120_000,
  },
  ocServer: vi.fn(),
}));

// Keep these unit tests independent from the developer's persisted settings.
vi.mock("./profiles/settings", () => ({
  QWEN_NATIVE_DEFAULTS: { enabled: false, opencodeModel: "", timeoutMs: 120_000 },
  readQwenNativeSettings: () => ({ ...h.settings }),
}));

vi.mock("./oc-server", () => ({ ocServer: h.ocServer }));

import {
  analyzeNativeImages,
  isQwenNativeVisionAvailable,
  nativeImageContext,
  rewriteNativeRequest,
} from "./qwen-native-vision";

const previousEnabled = process.env.OPENCODE_WEBUI_QWEN_NATIVE;
const previousModel = process.env.OPENCODE_WEBUI_QWEN_MODEL;

beforeEach(() => {
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
      // Tools are disabled so the analysis session cannot touch the workspace.
      tools: { bash: false, read: false },
    },
  });
  // The temporary session is deleted afterwards.
  expect(
    h.ocServer.mock.calls.some(
      ([, path, init]) =>
        String(path) === "/session/session-1" &&
        (init as { method?: string } | undefined)?.method === "DELETE",
    ),
  ).toBe(true);
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
