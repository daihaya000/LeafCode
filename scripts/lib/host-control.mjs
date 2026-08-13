import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Shared host-control base-URL resolution.
 *
 * Single source of truth for both:
 * - `web/src/lib/host-control.ts` (web / TypeScript, via `host-control.d.ts`)
 * - `scripts/production-webui-build-guard.mjs` (CLI / Node ESM)
 *
 * Order: `OPENCODE_WEBUI_HOST_CONTROL_URL` env → `%APPDATA%/opencode-webui/
 * host-control.json` → default port. Non-loopback URLs are rejected at every
 * step so restart/voice-input cannot be redirected off-box (D2 / 6-2).
 */
export const DEFAULT_CONTROL_URL = "http://127.0.0.1:18765";

export function isLoopbackControlUrl(raw) {
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
 * env / exists / read are injectable for tests.
 */
export function resolveHostControlUrl({
  env = process.env,
  exists = existsSync,
  read = readFileSync,
} = {}) {
  const fromEnv = env.OPENCODE_WEBUI_HOST_CONTROL_URL?.trim();
  if (fromEnv) {
    const cleaned = fromEnv.replace(/\/+$/, "");
    if (isLoopbackControlUrl(cleaned)) return cleaned;
  }

  const appData = env.APPDATA;
  if (appData) {
    const file = join(appData, "opencode-webui", "host-control.json");
    if (exists(file)) {
      try {
        const data = JSON.parse(read(file, "utf8"));
        if (typeof data.url === "string" && data.url.trim()) {
          const cleaned = data.url.trim().replace(/\/+$/, "");
          if (isLoopbackControlUrl(cleaned)) return cleaned;
        }
        if (typeof data.port === "number" && Number.isFinite(data.port)) {
          return `http://127.0.0.1:${data.port}`;
        }
      } catch {
        // fall through to the default
      }
    }
  }

  return DEFAULT_CONTROL_URL;
}
