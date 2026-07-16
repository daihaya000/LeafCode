import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function dataDir(): string {
  if (process.platform === "win32") {
    const base = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "opencode-webui");
  }
  return path.join(os.homedir(), ".opencode-webui");
}

export function dbPath(): string {
  return path.join(dataDir(), "webui.db");
}

export function ensureDataDir(): void {
  fs.mkdirSync(dataDir(), { recursive: true });
}
