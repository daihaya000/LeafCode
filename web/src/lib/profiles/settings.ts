import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../paths";

export type ProfileSetupSettings = {
  browserBridge: boolean;
  cursorAcp: boolean;
  claudeAuth: boolean;
};

const DEFAULT_SETTINGS: ProfileSetupSettings = {
  browserBridge: true,
  cursorAcp: true,
  claudeAuth: true,
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
