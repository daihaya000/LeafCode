import { beforeEach, describe, expect, it, vi } from "vitest";

const registerOllamaProvider = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ollama-provider", () => ({ registerOllamaProvider }));

import { POST } from "./route";

const request = () =>
  new Request("http://127.0.0.1:3000/api/ollama/register", {
    method: "POST",
    headers: { host: "127.0.0.1:3000" },
  });

// ブロック本体で書く: `() => mock.mockReset()` はモック関数自体を返し、
// Vitest がそれをテスト後のクリーンアップ関数として呼んでしまう。
beforeEach(() => {
  registerOllamaProvider.mockReset();
});

describe("POST /api/ollama/register", () => {
  it("re-registers the installed models and reports the vision ones", async () => {
    registerOllamaProvider.mockResolvedValue({
      providerID: "ollama",
      models: ["qwen2.5vl:7b", "llama3:8b"],
      visionModels: ["qwen2.5vl:7b"],
    });

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      providerID: "ollama",
      models: ["qwen2.5vl:7b", "llama3:8b"],
      visionModels: ["qwen2.5vl:7b"],
      restartRequired: true,
    });
  });

  it("returns the failure reason when nothing can be registered", async () => {
    registerOllamaProvider.mockRejectedValue(
      new Error("Ollamaのモデルが見つかりません。"),
    );

    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "Ollamaのモデルが見つかりません。",
    });
  });
});
