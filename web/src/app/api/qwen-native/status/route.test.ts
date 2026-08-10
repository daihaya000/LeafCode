import { NextRequest } from "next/server";
import { afterEach, expect, it } from "vitest";
import { GET } from "./route";

const previousEnabled = process.env.OPENCODE_WEBUI_QWEN_NATIVE;

afterEach(() => {
  if (previousEnabled === undefined) delete process.env.OPENCODE_WEBUI_QWEN_NATIVE;
  else process.env.OPENCODE_WEBUI_QWEN_NATIVE = previousEnabled;
});

function request() {
  return new NextRequest("http://127.0.0.1:3000/api/qwen-native/status", {
    headers: { host: "127.0.0.1:3000" },
  });
}

it("reports native vision availability without exposing local credentials", async () => {
  process.env.OPENCODE_WEBUI_QWEN_NATIVE = "1";
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ nativeAvailable: true });
});

it("reports unavailable when native integration is disabled", async () => {
  process.env.OPENCODE_WEBUI_QWEN_NATIVE = "0";
  const response = await GET(request());
  expect(await response.json()).toEqual({ nativeAvailable: false });
});
