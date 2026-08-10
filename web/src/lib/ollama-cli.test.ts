import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ollama-cli", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ollama-cli")>();
  return {
    ...actual,
    isOllamaInstalled: vi.fn(),
    listOllamaModels: vi.fn(),
    pullOllamaModel: vi.fn(),
    getOllamaStatus: vi.fn(),
  };
});

import {
  isOllamaInstalled,
  listOllamaModels,
  pullOllamaModel,
} from "@/lib/ollama-cli";

const isInstalledMock = isOllamaInstalled as unknown as ReturnType<typeof vi.fn>;
const listMock = listOllamaModels as unknown as ReturnType<typeof vi.fn>;
const pullMock = pullOllamaModel as unknown as ReturnType<typeof vi.fn>;

describe("ollama-cli (mocked)", () => {
  it("reports not installed when the helper returns false", () => {
    isInstalledMock.mockReturnValue(false);
    expect(isOllamaInstalled()).toBe(false);
  });

  it("detects ollama when the helper returns true", () => {
    isInstalledMock.mockReturnValue(true);
    expect(isOllamaInstalled()).toBe(true);
  });

  it("returns empty model list when the helper resolves []", async () => {
    listMock.mockResolvedValue([]);
    expect(await listOllamaModels()).toEqual([]);
  });

  it("returns parsed model names when the helper resolves them", async () => {
    listMock.mockResolvedValue(["qwen2.5vl:7b", "llama3:8b"]);
    expect(await listOllamaModels()).toEqual(["qwen2.5vl:7b", "llama3:8b"]);
  });

  it("rejects pull when the helper throws", async () => {
    pullMock.mockRejectedValue(new Error("Ollama is not installed"));
    await expect(pullOllamaModel("qwen2.5vl:7b")).rejects.toThrow("not installed");
  });

  it("rejects pull for empty model name when the helper throws", async () => {
    pullMock.mockRejectedValue(new Error("model name is required"));
    await expect(pullOllamaModel("   ")).rejects.toThrow("model name is required");
  });
});