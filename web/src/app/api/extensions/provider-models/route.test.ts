import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ocServer: vi.fn(),
  dataDir: "",
}));

vi.mock("@/lib/oc-server", () => ({
  ocServer: h.ocServer,
  OcError: class OcError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/paths", () => ({
  dataDir: () => h.dataDir,
  ensureDataDir: () => undefined,
}));

import { GET } from "./route";

let data: string;

const MOCK_PROVIDER_RESPONSE = {
  all: [
    {
      id: "openai",
      name: "OpenAI",
      models: {
        "gpt-5": { name: "GPT-5" },
      },
    },
    {
      id: "anthropic",
      name: "Anthropic",
      models: {
        "claude-sonnet-4-5": { name: "Claude Sonnet 4.5" },
      },
    },
  ],
  connected: ["openai", "anthropic"],
  default: { provider: "openai", model: "gpt-5" },
};

beforeEach(() => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), "api-provider-models-"));
  h.dataDir = data;
  h.ocServer.mockReset();
  h.ocServer.mockResolvedValue(MOCK_PROVIDER_RESPONSE);
});

afterEach(() => {
  fs.rmSync(data, { recursive: true, force: true });
});

describe("GET /api/extensions/provider-models", () => {
  it("returns providers with models", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: { id: string; name: string; enabled: boolean; models: { id: string; name: string; enabled: boolean }[] }[];
    };
    expect(body.providers).toHaveLength(2);
    expect(body.providers[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      enabled: true,
      models: expect.any(Array),
    });
  });

  it("returns 500 with safe message when engine is unavailable", async () => {
    h.ocServer.mockRejectedValue(new Error("engine down"));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("プロバイダー一覧を取得できません");
  });
});
