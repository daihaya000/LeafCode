import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
}));

vi.mock("@/lib/profiles/settings", () => ({
  QWEN_NATIVE_DEFAULTS: {
    enabled: false,
    opencodeModel: "",
    timeoutMs: 120_000,
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
  opencodeModel: "",
  timeoutMs: 120_000,
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

  it("saves an OpenCode registered image model", async () => {
    const next = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      opencodeModel: "openai::gpt-4o",
    };
    const response = await PUT(local("PUT", next));
    expect(response.status).toBe(200);
    expect(h.write).toHaveBeenCalledWith(next);
    expect(await response.json()).toEqual(next);
  });

  it("accepts a locally registered Ollama model id with a tag", async () => {
    const next = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      opencodeModel: "ollama::qwen2.5vl:7b",
    };
    const response = await PUT(local("PUT", next));
    expect(response.status).toBe(200);
    expect(h.write).toHaveBeenCalledWith(next);
  });

  it("rejects missing fields", async () => {
    const response = await PUT(local("PUT", { enabled: true }));
    expect(response.status).toBe(400);
  });

  it("rejects enabling without an OpenCode model", async () => {
    const response = await PUT(local("PUT", { ...DEFAULT_SETTINGS, enabled: true }));
    expect(response.status).toBe(400);
    expect(h.write).not.toHaveBeenCalled();
  });

  it("rejects a model without the providerID::modelID form", async () => {
    const response = await PUT(
      local("PUT", { ...DEFAULT_SETTINGS, enabled: true, opencodeModel: "qwen2.5vl:7b" }),
    );
    expect(response.status).toBe(400);
  });

  it("keeps a disabled setting saveable without a model", async () => {
    const response = await PUT(local("PUT", DEFAULT_SETTINGS));
    expect(response.status).toBe(200);
    expect(h.write).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it("rejects non-positive timeoutMs", async () => {
    const response = await PUT(local("PUT", { ...DEFAULT_SETTINGS, timeoutMs: -1 }));
    expect(response.status).toBe(400);
  });
});
