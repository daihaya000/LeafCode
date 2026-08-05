import { existsSync, readFileSync } from "fs";
import { join } from "path";

const DEFAULT_CONTROL_URL = "http://127.0.0.1:18765";

type ControlFile = {
  url?: string;
  port?: number;
};

function isLoopbackControlUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "::1" ||
      host === "0:0:0:0:0:0:0:1"
    );
  } catch {
    return false;
  }
}

/**
 * Resolve the localhost host-control base URL.
 * Prefer the env injected by the tray host; fall back to %APPDATA% file / default port.
 * Non-loopback URLs are rejected so restart/voice-input cannot be redirected off-box.
 */
export function resolveHostControlUrl(): string {
  const fromEnv = process.env.OPENCODE_WEBUI_HOST_CONTROL_URL?.trim();
  if (fromEnv) {
    const cleaned = fromEnv.replace(/\/+$/, "");
    if (isLoopbackControlUrl(cleaned)) return cleaned;
  }

  const appData = process.env.APPDATA;
  if (appData) {
    const file = join(appData, "opencode-webui", "host-control.json");
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, "utf8")) as ControlFile;
        if (typeof data.url === "string" && data.url.trim()) {
          const cleaned = data.url.trim().replace(/\/+$/, "");
          if (isLoopbackControlUrl(cleaned)) return cleaned;
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

export function hostVoiceInputPath(): string {
  return "/voice-input";
}

export function hostAllowFirewallPath(): string {
  return "/allow-firewall";
}

/** GET path for the host log tail. `since` is the last-seen entry's `seq`. */
export function hostLogsPath(since: number | null): string {
  return since !== null && Number.isFinite(since)
    ? `/logs?since=${since}`
    : "/logs";
}
