import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeQwenMmImages,
  isQwenMmConnected,
  isQwenNativeVisionAvailable,
  persistQwenMmImages,
  qwenMmImageInstructions,
  rewriteQwenNativeRequest,
  rewriteQwenMmRequest,
} from "./qwen-mm-fallback";

const dirs: string[] = [];
let previousAppData: string | undefined;
const previousApiKey = process.env.DASHSCOPE_API_KEY;
const previousBaseUrl = process.env.DASHSCOPE_BASE_URL;
const previousNativeDisabled = process.env.OPENCODE_WEBUI_QWEN_NATIVE;

afterEach(() => {
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  previousAppData = undefined;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  if (previousApiKey === undefined) delete process.env.DASHSCOPE_API_KEY;
  else process.env.DASHSCOPE_API_KEY = previousApiKey;
  if (previousBaseUrl === undefined) delete process.env.DASHSCOPE_BASE_URL;
  else process.env.DASHSCOPE_BASE_URL = previousBaseUrl;
  if (previousNativeDisabled === undefined) delete process.env.OPENCODE_WEBUI_QWEN_NATIVE;
  else process.env.OPENCODE_WEBUI_QWEN_NATIVE = previousNativeDisabled;
  vi.unstubAllGlobals();
});

function setupAppData(): string {
  previousAppData = process.env.APPDATA;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-mm-fallback-"));
  dirs.push(root);
  process.env.APPDATA = root;
  return root;
}

describe("Qwen-MM image fallback", () => {
  it("recognizes only a connected qwen-mm-plugins-core MCP status", () => {
    expect(isQwenMmConnected({ "qwen-mm-plugins-core": { status: "connected" } })).toBe(true);
    expect(isQwenMmConnected({ "qwen-mm-plugins-core": { status: "failed" } })).toBe(false);
    expect(isQwenMmConnected({})).toBe(false);
  });

  it("persists data URLs under an app-owned session directory", () => {
    const root = setupAppData();
    const [filePath] = persistQwenMmImages(
      [{ dataUrl: "data:image/png;base64,AA==", mime: "image/png", name: "shot.png" }],
      "ses_test-1",
    );
    expect(filePath).toContain(path.join(root, "opencode-webui", "qwen-mm-attachments", "ses_test-1"));
    expect(fs.readFileSync(filePath)).toEqual(Buffer.from([0]));
  });

  it("rewrites image parts into a text instruction for the model", () => {
    setupAppData();
    const body = rewriteQwenMmRequest(
      {
        parts: [
          { type: "text", text: "この画像を説明して" },
          { type: "file", mime: "image/png", url: "data:image/png;base64,AA==" },
        ],
        model: { providerID: "text", modelID: "only" },
      },
      "ses_test-2",
    );
    expect(body.parts).toHaveLength(1);
    expect((body.parts as { text: string }[])[0]?.text).toContain("vision_chat");
    expect((body.parts as { text: string }[])[0]?.text).toContain("この画像を説明して");
    expect((body.parts as { text: string }[])[0]?.text).toContain("qwen-mm-image-attachments");
  });

  it("rewrites v2 prompt.files while preserving non-image files", () => {
    setupAppData();
    const body = rewriteQwenMmRequest(
      {
        prompt: {
          text: "OCRして",
          files: [
            { mime: "image/png", uri: "data:image/png;base64,AA==" },
            { mime: "text/plain", uri: "data:text/plain;base64,QQ==" },
          ],
        },
      },
      "ses_test-3",
    );
    const prompt = body.prompt as { text: string; files: unknown[] };
    expect(prompt.text).toContain("vision_chat");
    expect(prompt.files).toHaveLength(1);
    expect(prompt.files[0]).toEqual({ mime: "text/plain", uri: "data:text/plain;base64,QQ==" });
  });

  it("builds an instruction even when the prompt is empty", () => {
    expect(qwenMmImageInstructions("", ["C:\\image.png"])).toContain("C:\\image.png");
  });

  it("calls DashScope directly and returns native visual analysis", async () => {
    process.env.DASHSCOPE_API_KEY = "dashscope-secret";
    process.env.DASHSCOPE_BASE_URL = "https://dashscope.example/v1/";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "A settings dialog is open." } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await analyzeQwenMmImages(
      "What is shown?",
      [{ dataUrl: "data:image/png;base64,AA==", mime: "image/png" }],
      fetchMock,
    );

    expect(result).toBe("A settings dialog is open.");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dashscope.example/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer dashscope-secret" }),
      }),
    );
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.model).toBe("qwen3.7-plus");
    expect(request.messages[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image_url",
          image_url: { url: "data:image/png;base64,AA==" },
        }),
      ]),
    );
  });

  it("rewrites images to native analysis without requiring MCP", async () => {
    process.env.DASHSCOPE_API_KEY = "dashscope-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "Visible text: Settings" } }] }),
          { status: 200 },
        ),
      ),
    );

    const body = await rewriteQwenNativeRequest({
      parts: [
        { type: "text", text: "Read this image" },
        { type: "file", mime: "image/png", url: "data:image/png;base64,AA==" },
      ],
    });

    expect(isQwenNativeVisionAvailable()).toBe(true);
    expect(body.parts).toHaveLength(1);
    expect((body.parts as { text: string }[])[0]?.text).toContain(
      "Visible text: Settings",
    );
    expect((body.parts as { text: string }[])[0]?.text).toContain(
      "未信頼データ",
    );
  });
});
