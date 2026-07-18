import { existsSync, readFileSync } from "fs";
import { join } from "path";

const DEFAULT_CONTROL_URL = "http://127.0.0.1:18765";

type ControlFile = {
  url?: string;
  port?: number;
};

/**
 * Resolve the localhost host-control base URL.
 * Prefer the env injected by the tray host; fall back to %APPDATA% file / default port.
 */
export function resolveHostControlUrl(): string {
  const fromEnv = process.env.OPENCODE_WEBUI_HOST_CONTROL_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  const appData = process.env.APPDATA;
  if (appData) {
    const file = join(appData, "opencode-webui", "host-control.json");
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, "utf8")) as ControlFile;
        if (typeof data.url === "string" && data.url.trim()) {
          return data.url.trim().replace(/\/+$/, "");
        }
        if (typeof data.port === "number" && Number.isFinite(data.port)) {
          return `http://127.0.0.1:${data.port}`;
        }
      } catch {
        // fall through
      }
    }
  }

  return DEFAULT_CONTROL_URL;
}

export type HostRestartTarget = "webui" | "opencode" | "all";

export function hostRestartPath(target: HostRestartTarget): string {
  if (target === "webui") return "/restart/webui";
  if (target === "opencode") return "/restart/opencode";
  return "/restart/all";
}
