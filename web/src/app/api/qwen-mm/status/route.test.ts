import { NextRequest } from "next/server";
import { afterEach, expect, it } from "vitest";
import { GET } from "./route";

const previousKey = process.env.DASHSCOPE_API_KEY;
const previousDisabled = process.env.OPENCODE_WEBUI_QWEN_NATIVE;

afterEach(() => {
  if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY;
  else process.env.DASHSCOPE_API_KEY = previousKey;
  if (previousDisabled === undefined) delete process.env.OPENCODE_WEBUI_QWEN_NATIVE;
  else process.env.OPENCODE_WEBUI_QWEN_NATIVE = previousDisabled;
});

function request() {
  return new NextRequest("http://127.0.0.1:3000/api/qwen-mm/status", {
    headers: { host: "127.0.0.1:3000" },
  });
}

it("reports native vision availability without exposing the API key", async () => {
  process.env.DASHSCOPE_API_KEY = "secret-key";
  delete process.env.OPENCODE_WEBUI_QWEN_NATIVE;

  const response = await GET(request());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ nativeAvailable: true });
});

it("reports unavailable when native integration is disabled", async () => {
  process.env.DASHSCOPE_API_KEY = "secret-key";
  process.env.OPENCODE_WEBUI_QWEN_NATIVE = "0";

  const response = await GET(request());

  expect(await response.json()).toEqual({ nativeAvailable: false });
});
