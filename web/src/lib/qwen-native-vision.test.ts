import { afterEach, expect, it, vi } from "vitest";
import {
  analyzeNativeImages,
  isQwenNativeVisionAvailable,
  nativeImageContext,
  rewriteNativeRequest,
} from "./qwen-native-vision";

// Keep these unit tests independent from the developer's persisted settings.
vi.mock("./profiles/settings", () => {
  const defaults = {
    enabled: false,
    source: "endpoint",
    opencodeModel: "",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen2.5vl:7b",
    apiKey: "ollama",
    timeoutMs: 120_000,
    maxTokens: 2048,
  };
  return {
    QWEN_NATIVE_DEFAULTS: defaults,
    readQwenNativeSettings: () => ({ ...defaults }),
  };
});

const previousEnabled = process.env.OPENCODE_WEBUI_QWEN_NATIVE;
const previousBaseUrl = process.env.OPENCODE_WEBUI_QWEN_LOCAL_BASE_URL;

afterEach(() => {
  if (previousEnabled === undefined) delete process.env.OPENCODE_WEBUI_QWEN_NATIVE;
  else process.env.OPENCODE_WEBUI_QWEN_NATIVE = previousEnabled;
  if (previousBaseUrl === undefined) delete process.env.OPENCODE_WEBUI_QWEN_LOCAL_BASE_URL;
  else process.env.OPENCODE_WEBUI_QWEN_LOCAL_BASE_URL = previousBaseUrl;
  vi.unstubAllGlobals();
});

it("calls local Ollama and returns visual analysis", async () => {
  process.env.OPENCODE_WEBUI_QWEN_NATIVE = "1";
  process.env.OPENCODE_WEBUI_QWEN_LOCAL_BASE_URL = "http://ollama.example/v1/";
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content: "A dialog is open." } }] }), { status: 200 }),
  );

  await expect(analyzeNativeImages(
    "What is shown?",
    [{ dataUrl: "data:image/png;base64,AA==", mime: "image/png" }],
    fetchMock,
  )).resolves.toBe("A dialog is open.");

  expect(fetchMock).toHaveBeenCalledWith(
    "http://ollama.example/v1/chat/completions",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer ollama" }),
    }),
  );
  const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
  expect(request.model).toBe("qwen2.5vl:7b");
  expect(request.messages[0].content).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: "image_url" })]),
  );
});

it("rewrites image parts into an untrusted analysis context", async () => {
  process.env.OPENCODE_WEBUI_QWEN_NATIVE = "1";
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "Visible text" } }] }), { status: 200 }),
    ),
  );

  const body = await rewriteNativeRequest({
    parts: [
      { type: "text", text: "Read this image" },
      { type: "file", mime: "image/png", url: "data:image/png;base64,AA==" },
    ],
  });

  expect(isQwenNativeVisionAvailable()).toBe(true);
  expect(body.parts).toHaveLength(1);
  expect((body.parts as { text: string }[])[0]?.text).toContain("Visible text");
  expect((body.parts as { text: string }[])[0]?.text).toContain("未信頼データ");
});

it("builds context for image-only prompts", () => {
  expect(nativeImageContext("", "Visible text")).toContain("Visible text");
});
