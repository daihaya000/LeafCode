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

import { __clearProviderResponseCacheForTest } from "@/lib/opencode-extensions/provider-models";
import { GET, POST } from "./route";

/** Loopback request so the shared API guard authorizes these handler calls. */
function localReq() {
  return new Request("http://127.0.0.1:3000/api", {
    headers: { host: "127.0.0.1:3000" },
  });
}


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
  process.env.OPENCODE_CONFIG_DIR = data;
  fs.writeFileSync(path.join(data, "opencode.jsonc"), "{}\n");
  h.ocServer.mockReset();
  h.ocServer.mockResolvedValue(MOCK_PROVIDER_RESPONSE);
  __clearProviderResponseCacheForTest();
});

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR;
  fs.rmSync(data, { recursive: true, force: true });
});

describe("GET /api/extensions/provider-models", () => {
  it("returns providers with models", async () => {
    const res = await GET(localReq());
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
    const res = await GET(localReq());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("プロバイダー一覧を取得できません");
  });
});

describe("POST /api/extensions/provider-models", () => {
  it("registers a custom provider", async () => {
    process.env.OPENCODE_CONFIG_DIR = data;
    fs.writeFileSync(path.join(data, "opencode.jsonc"), "{}\n");

    const res = await POST(
      new Request("http://localhost/api/extensions/provider-models", { headers: { host: "127.0.0.1:3000" },
        method: "POST",
        body: JSON.stringify({
          id: "custom",
          name: "Custom AI",
          baseURL: "https://api.example.com/v1",
          apiKeyEnv: "CUSTOM_API_KEY",
          models: [{ id: "custom-model", name: "Custom Model" }],
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, requiresRestart: true });
    const config = JSON.parse(fs.readFileSync(path.join(data, "opencode.jsonc"), "utf8"));
    expect(config.provider.custom.options.apiKey).toBe("{env:CUSTOM_API_KEY}");
  });
});
