import { beforeEach, describe, expect, it, vi } from "vitest";

const ocServer = vi.hoisted(() => vi.fn());
const listConfiguredImageModels = vi.hoisted(() => vi.fn());
vi.mock("@/lib/oc-server", () => ({ ocServer }));
vi.mock("@/lib/opencode-extensions/provider-models", () => ({
  listConfiguredImageModels,
}));

import { GET } from "./route";

const request = () => new Request("http://127.0.0.1:3000/api/qwen-native/models", {
  headers: { host: "127.0.0.1:3000" },
});

beforeEach(() => {
  ocServer.mockReset();
  listConfiguredImageModels.mockReset().mockReturnValue([]);
});

describe("GET /api/qwen-native/models", () => {
  it("returns only connected image-capable models", async () => {
    ocServer.mockResolvedValue({
      connected: ["openai"],
      all: [
        {
          id: "openai",
          name: "OpenAI",
          models: {
            vision: { name: "Vision", capabilities: { input: { image: true } } },
            text: { name: "Text", capabilities: { input: { image: false } } },
          },
        },
        {
          id: "offline",
          models: { vision: { capabilities: { attachment: true } } },
        },
      ],
    });

    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      models: [{ value: "openai::vision", label: "Vision", group: "OpenAI" }],
    });
  });

  it("adds config-declared image models the engine has not picked up yet", async () => {
    // ローカルOllamaを登録した直後はエンジン再起動前で /provider に出ない。
    ocServer.mockResolvedValue({ connected: ["openai"], all: [] });
    listConfiguredImageModels.mockReturnValue([
      {
        value: "ollama::qwen2.5vl:7b",
        label: "qwen2.5vl:7b",
        group: "Ollama (ローカル)",
      },
    ]);

    const response = await GET(request());
    expect(await response.json()).toEqual({
      models: [
        {
          value: "ollama::qwen2.5vl:7b",
          label: "qwen2.5vl:7b",
          group: "Ollama (ローカル)",
        },
      ],
    });
  });

  it("does not duplicate a model reported by both sources", async () => {
    ocServer.mockResolvedValue({
      connected: ["ollama"],
      all: [
        {
          id: "ollama",
          name: "Ollama (ローカル)",
          models: { "qwen2.5vl:7b": { capabilities: { attachment: true } } },
        },
      ],
    });
    listConfiguredImageModels.mockReturnValue([
      { value: "ollama::qwen2.5vl:7b", label: "config", group: "Ollama (ローカル)" },
    ]);

    const { models } = (await (await GET(request())).json()) as {
      models: { value: string }[];
    };
    expect(models).toHaveLength(1);
  });

  it("falls back to config-declared models when the engine is unreachable", async () => {
    ocServer.mockRejectedValue(new Error("engine down"));
    listConfiguredImageModels.mockReturnValue([
      { value: "ollama::llava", label: "llava", group: "Ollama (ローカル)" },
    ]);

    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      models: [{ value: "ollama::llava", label: "llava", group: "Ollama (ローカル)" }],
    });
  });

  it("returns 502 when the engine fails and no config model exists", async () => {
    ocServer.mockRejectedValue(new Error("engine down"));
    const response = await GET(request());
    expect(response.status).toBe(502);
  });
});
