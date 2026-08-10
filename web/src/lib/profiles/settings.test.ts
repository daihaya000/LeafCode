import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  QWEN_NATIVE_DEFAULTS,
  readQwenNativeSettings,
  writeQwenNativeSettings,
} from "./settings";

vi.mock("../paths", () => ({
  dataDir: () => testDir,
}));

let testDir: string;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-native-settings-"));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("readQwenNativeSettings / writeQwenNativeSettings", () => {
  it("returns defaults when the file is missing", () => {
    expect(readQwenNativeSettings()).toEqual(QWEN_NATIVE_DEFAULTS);
  });

  it("round-trips a complete settings object", () => {
    const next = {
      ...QWEN_NATIVE_DEFAULTS,
      enabled: true,
      opencodeModel: "ollama::qwen2.5vl:7b",
    };
    writeQwenNativeSettings(next);
    expect(readQwenNativeSettings()).toEqual(next);
  });

  it("fills missing fields with defaults", () => {
    fs.writeFileSync(
      path.join(testDir, "qwen-native-settings.json"),
      JSON.stringify({ enabled: true }),
      "utf8",
    );
    const settings = readQwenNativeSettings();
    expect(settings.enabled).toBe(true);
    expect(settings.opencodeModel).toBe("");
    expect(settings.timeoutMs).toBe(QWEN_NATIVE_DEFAULTS.timeoutMs);
  });

  it("ignores invalid numeric fields", () => {
    fs.writeFileSync(
      path.join(testDir, "qwen-native-settings.json"),
      JSON.stringify({ enabled: true, timeoutMs: -1 }),
      "utf8",
    );
    expect(readQwenNativeSettings().timeoutMs).toBe(QWEN_NATIVE_DEFAULTS.timeoutMs);
  });

  it("drops the removed OpenAI-compatible endpoint fields", () => {
    fs.writeFileSync(
      path.join(testDir, "qwen-native-settings.json"),
      JSON.stringify({
        enabled: true,
        source: "endpoint",
        opencodeModel: "",
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "qwen2.5vl:7b",
        apiKey: "ollama",
        timeoutMs: 120_000,
        maxTokens: 2048,
      }),
      "utf8",
    );
    expect(readQwenNativeSettings()).toEqual({
      enabled: true,
      opencodeModel: "",
      timeoutMs: 120_000,
    });
  });

  it("falls back to defaults on malformed JSON", () => {
    fs.writeFileSync(
      path.join(testDir, "qwen-native-settings.json"),
      "{not json",
      "utf8",
    );
    expect(readQwenNativeSettings()).toEqual(QWEN_NATIVE_DEFAULTS);
  });
});
