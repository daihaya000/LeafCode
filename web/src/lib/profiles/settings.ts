import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../paths";

export type ProfileSetupSettings = {
  browserBridge: boolean;
  cursorAcp: boolean;
  claudeAuth: boolean;
  commandcodeAuth: boolean;
};

export type QwenNativeSettings = {
  enabled: boolean;
  source: "endpoint" | "opencode";
  opencodeModel: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  maxTokens: number;
};

export const QWEN_NATIVE_DEFAULTS: QwenNativeSettings = {
  enabled: false,
  source: "endpoint",
  opencodeModel: "",
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "qwen2.5vl:7b",
  apiKey: "ollama",
  timeoutMs: 120_000,
  maxTokens: 2048,
};

const DEFAULT_SETTINGS: ProfileSetupSettings = {
  browserBridge: true,
  cursorAcp: true,
  claudeAuth: true,
  commandcodeAuth: true,
};

function settingsPath(): string {
  return path.join(dataDir(), "profile-setup-settings.json");
}

export function readProfileSetupSettings(): ProfileSetupSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as Partial<ProfileSetupSettings>;
    return {
      browserBridge: parsed.browserBridge !== false,
      cursorAcp: parsed.cursorAcp !== false,
      claudeAuth: parsed.claudeAuth !== false,
      commandcodeAuth: parsed.commandcodeAuth !== false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeProfileSetupSettings(settings: ProfileSetupSettings): ProfileSetupSettings {
  fs.mkdirSync(dataDir(), { recursive: true });
  const file = settingsPath();
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
  return settings;
}

function qwenNativeSettingsPath(): string {
  return path.join(dataDir(), "qwen-native-settings.json");
}

export function readQwenNativeSettings(): QwenNativeSettings {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(qwenNativeSettingsPath(), "utf8"),
    ) as Partial<QwenNativeSettings>;
    return {
      enabled: parsed.enabled === true,
      source: parsed.source === "opencode" ? "opencode" : "endpoint",
      opencodeModel:
        typeof parsed.opencodeModel === "string" ? parsed.opencodeModel.trim() : "",
      baseUrl:
        typeof parsed.baseUrl === "string" && parsed.baseUrl.trim()
          ? parsed.baseUrl
          : QWEN_NATIVE_DEFAULTS.baseUrl,
      model:
        typeof parsed.model === "string" && parsed.model.trim()
          ? parsed.model
          : QWEN_NATIVE_DEFAULTS.model,
      apiKey:
        typeof parsed.apiKey === "string" && parsed.apiKey.trim()
          ? parsed.apiKey
          : QWEN_NATIVE_DEFAULTS.apiKey,
      timeoutMs:
        typeof parsed.timeoutMs === "number" && Number.isFinite(parsed.timeoutMs) && parsed.timeoutMs > 0
          ? parsed.timeoutMs
          : QWEN_NATIVE_DEFAULTS.timeoutMs,
      maxTokens:
        typeof parsed.maxTokens === "number" && Number.isFinite(parsed.maxTokens) && parsed.maxTokens > 0
          ? parsed.maxTokens
          : QWEN_NATIVE_DEFAULTS.maxTokens,
    };
  } catch {
    return { ...QWEN_NATIVE_DEFAULTS };
  }
}

export function writeQwenNativeSettings(settings: QwenNativeSettings): QwenNativeSettings {
  fs.mkdirSync(dataDir(), { recursive: true });
  const file = qwenNativeSettingsPath();
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
  return settings;
}
