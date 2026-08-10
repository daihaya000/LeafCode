import { beforeEach, describe, expect, it, vi } from "vitest";

const ocServer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/oc-server", () => ({ ocServer }));

import { GET } from "./route";

const request = () => new Request("http://127.0.0.1:3000/api/qwen-native/models", {
  headers: { host: "127.0.0.1:3000" },
});

beforeEach(() => ocServer.mockReset());

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
});
