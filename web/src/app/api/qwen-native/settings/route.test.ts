import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
}));

vi.mock("@/lib/profiles/settings", () => ({
  QWEN_NATIVE_DEFAULTS: {
    enabled: false,
    source: "endpoint",
    opencodeModel: "",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen2.5vl:7b",
    apiKey: "ollama",
    timeoutMs: 120_000,
    maxTokens: 2048,
  },
  readQwenNativeSettings: h.read,
  writeQwenNativeSettings: h.write,
}));

import { GET, PUT } from "./route";

const local = (method: string, body?: unknown) =>
  new Request("http://127.0.0.1:3000/api/qwen-native/settings", {
    method,
    headers: {
      host: "127.0.0.1:3000",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const DEFAULT_SETTINGS = {
  enabled: false,
  source: "endpoint",
  opencodeModel: "",
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "qwen2.5vl:7b",
  apiKey: "ollama",
  timeoutMs: 120_000,
  maxTokens: 2048,
};

beforeEach(() => {
  h.read.mockReset().mockReturnValue({ ...DEFAULT_SETTINGS });
  h.write.mockReset().mockImplementation((value) => value);
});

describe("/api/qwen-native/settings", () => {
  it("returns current settings on GET", async () => {
    const response = await GET(local("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(DEFAULT_SETTINGS);
  });

  it("saves valid settings on PUT", async () => {
    const next = { ...DEFAULT_SETTINGS, enabled: true, model: "qwen2.5vl:32b" };
    const response = await PUT(local("PUT", next));
    expect(response.status).toBe(200);
    expect(h.write).toHaveBeenCalledWith(next);
    expect(await response.json()).toEqual(next);
  });

  it("rejects missing fields", async () => {
    const response = await PUT(local("PUT", { enabled: true }));
    expect(response.status).toBe(400);
  });

  it("saves an OpenCode registered image model", async () => {
    const next = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      source: "opencode",
      opencodeModel: "openai::gpt-4o",
    };
    const response = await PUT(local("PUT", next));
    expect(response.status).toBe(200);
    expect(h.write).toHaveBeenCalledWith(next);
  });

  it("rejects non-positive timeoutMs", async () => {
    const response = await PUT(local("PUT", { ...DEFAULT_SETTINGS, timeoutMs: -1 }));
    expect(response.status).toBe(400);
  });

  it("rejects non-finite maxTokens", async () => {
    const response = await PUT(local("PUT", { ...DEFAULT_SETTINGS, maxTokens: Number.NaN }));
    expect(response.status).toBe(400);
  });
});
