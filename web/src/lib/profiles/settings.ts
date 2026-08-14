import fs from "node:fs";
import path from "node:path";
import {
  VISION_ANALYSIS_TIMEOUT_DEFAULT_MS,
  clampVisionAnalysisTimeoutMs,
} from "../image-send-timeout";
import { dataDir } from "../paths";

export type ProfileSetupSettings = {
  browserBridge: boolean;
  cursorAcp: boolean;
  claudeAuth: boolean;
  commandcodeAuth: boolean;
  autoInstallOnStartup: boolean;
};

/**
 * 画像事前解析は OpenCode 登録モデルへ一本化している。ローカル Ollama も
 * `opencode.jsonc` の provider として登録し、`providerID::modelID` で参照する
 * （設定画面「画像解析」タブのセットアップボタンが登録まで行う）。
 */
export type QwenNativeSettings = {
  enabled: boolean;
  /** `providerID::modelID`。未設定の間は事前解析を有効化できない。 */
  opencodeModel: string;
  timeoutMs: number;
};

export const QWEN_NATIVE_DEFAULTS: QwenNativeSettings = {
  enabled: false,
  opencodeModel: "",
  timeoutMs: VISION_ANALYSIS_TIMEOUT_DEFAULT_MS,
};

const DEFAULT_SETTINGS: ProfileSetupSettings = {
  browserBridge: true,
  cursorAcp: true,
  claudeAuth: true,
  commandcodeAuth: true,
  autoInstallOnStartup: false,
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
      autoInstallOnStartup: parsed.autoInstallOnStartup === true,
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
      // 旧 `source: "endpoint"` 設定（baseUrl/model/apiKey）は読み捨てる。
      // OpenCode モデル未選択なら enabled でも利用不可として扱われる。
      enabled: parsed.enabled === true,
      opencodeModel:
        typeof parsed.opencodeModel === "string" ? parsed.opencodeModel.trim() : "",
      timeoutMs:
        typeof parsed.timeoutMs === "number" && Number.isFinite(parsed.timeoutMs) && parsed.timeoutMs > 0
          ? clampVisionAnalysisTimeoutMs(parsed.timeoutMs)
          : QWEN_NATIVE_DEFAULTS.timeoutMs,
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
