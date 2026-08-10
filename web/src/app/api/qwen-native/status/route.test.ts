import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/profiles/settings", () => ({
  readQwenNativeSettings: vi.fn(() => ({
    enabled: false,
    opencodeModel: "",
    timeoutMs: 120_000,
  })),
  QWEN_NATIVE_DEFAULTS: {
    enabled: false,
    opencodeModel: "",
    timeoutMs: 120_000,
  },
}));

import { GET } from "./route";

const previousEnabled = process.env.OPENCODE_WEBUI_QWEN_NATIVE;
const previousModel = process.env.OPENCODE_WEBUI_QWEN_MODEL;

beforeEach(() => {
  delete process.env.OPENCODE_WEBUI_QWEN_NATIVE;
  delete process.env.OPENCODE_WEBUI_QWEN_MODEL;
});

afterEach(() => {
  if (previousEnabled === undefined) delete process.env.OPENCODE_WEBUI_QWEN_NATIVE;
  else process.env.OPENCODE_WEBUI_QWEN_NATIVE = previousEnabled;
  if (previousModel === undefined) delete process.env.OPENCODE_WEBUI_QWEN_MODEL;
  else process.env.OPENCODE_WEBUI_QWEN_MODEL = previousModel;
});

function request() {
  return new NextRequest("http://127.0.0.1:3000/api/qwen-native/status", {
    headers: { host: "127.0.0.1:3000" },
  });
}

it("reports native vision availability without exposing the model selection", async () => {
  process.env.OPENCODE_WEBUI_QWEN_NATIVE = "1";
  process.env.OPENCODE_WEBUI_QWEN_MODEL = "ollama::qwen2.5vl:7b";
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ nativeAvailable: true });
});

it("reports unavailable when enabled without a registered analysis model", async () => {
  process.env.OPENCODE_WEBUI_QWEN_NATIVE = "1";
  const response = await GET(request());
  expect(await response.json()).toEqual({ nativeAvailable: false });
});

it("reports unavailable when native integration is disabled", async () => {
  process.env.OPENCODE_WEBUI_QWEN_NATIVE = "0";
  const response = await GET(request());
  expect(await response.json()).toEqual({ nativeAvailable: false });
});