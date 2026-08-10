import { afterEach, describe, expect, it, vi } from "vitest";

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
  fetchOllamaModelCapabilities,
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

describe("fetchOllamaModelCapabilities", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads vision/tools from the /api/show capabilities list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ capabilities: ["completion", "vision"] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchOllamaModelCapabilities("qwen2.5vl:7b")).resolves.toEqual({
      vision: true,
      tools: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/show",
      expect.objectContaining({ method: "POST" }),
    );
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("qwen2.5vl:7b");
  });

  it("returns null when the daemon is unreachable so callers can fall back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(fetchOllamaModelCapabilities("llama3:8b")).resolves.toBeNull();
  });

  it("returns null for an unexpected response shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    );
    await expect(fetchOllamaModelCapabilities("llama3:8b")).resolves.toBeNull();
  });

  it("does not call Ollama for an empty model name", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchOllamaModelCapabilities("  ")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});