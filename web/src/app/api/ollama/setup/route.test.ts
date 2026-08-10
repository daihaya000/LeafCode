import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  isOllamaInstalled: vi.fn(),
  installOllama: vi.fn(),
  listOllamaModels: vi.fn(),
  pullOllamaModel: vi.fn(),
  registerOllamaProvider: vi.fn(),
}));

vi.mock("@/lib/ollama-cli", () => ({
  isOllamaInstalled: h.isOllamaInstalled,
  installOllama: h.installOllama,
  listOllamaModels: h.listOllamaModels,
  pullOllamaModel: h.pullOllamaModel,
}));

vi.mock("@/lib/ollama-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ollama-provider")>();
  return { ...actual, registerOllamaProvider: h.registerOllamaProvider };
});

import { POST } from "./route";

const request = (body?: unknown) =>
  new Request("http://127.0.0.1:3000/api/ollama/setup", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

beforeEach(() => {
  h.isOllamaInstalled.mockReset().mockReturnValue(true);
  h.installOllama.mockReset().mockResolvedValue({ installed: true, message: "ok" });
  h.listOllamaModels.mockReset().mockResolvedValue([]);
  h.pullOllamaModel.mockReset().mockResolvedValue(undefined);
  h.registerOllamaProvider.mockReset().mockResolvedValue({
    providerID: "ollama",
    models: ["qwen2.5vl:7b"],
    visionModels: ["qwen2.5vl:7b"],
  });
});

describe("POST /api/ollama/setup", () => {
  it("installs, pulls and registers in one call", async () => {
    h.isOllamaInstalled.mockReturnValue(false);

    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      modelValue: string;
      steps: string[];
    };
    expect(body.ok).toBe(true);
    expect(h.installOllama).toHaveBeenCalledTimes(1);
    expect(h.pullOllamaModel).toHaveBeenCalledWith("qwen2.5vl:7b");
    expect(h.registerOllamaProvider).toHaveBeenCalledTimes(1);
    expect(body.modelValue).toBe("ollama::qwen2.5vl:7b");
    expect(body.steps.length).toBe(3);
  });

  it("skips the pull when the requested model is already present", async () => {
    h.listOllamaModels.mockResolvedValue(["llava:13b"]);

    const response = await POST(request({ model: "llava:13b" }));
    expect(response.status).toBe(200);
    expect(h.installOllama).not.toHaveBeenCalled();
    expect(h.pullOllamaModel).not.toHaveBeenCalled();
    expect(h.registerOllamaProvider).toHaveBeenCalledTimes(1);
  });

  it("reports the failing step without registering", async () => {
    h.isOllamaInstalled.mockReturnValue(false);
    h.installOllama.mockResolvedValue({ installed: false, message: "winget install failed" });

    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "winget install failed",
    });
    expect(h.registerOllamaProvider).not.toHaveBeenCalled();
  });

  it("surfaces a pull failure as an error response", async () => {
    h.pullOllamaModel.mockRejectedValue(new Error("Ollama pull failed"));

    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: "Ollama pull failed" });
    expect(h.registerOllamaProvider).not.toHaveBeenCalled();
  });
});
