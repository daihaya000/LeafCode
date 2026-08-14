/**
 * Next.js server-side instrumentation: runs once when the server starts
 * (dev and production), before any route handler reads env vars.
 *
 * Copies legacy OPENCODE_WEBUI_* env vars onto the LEAFCODE_* names so
 * pre-rebrand user configuration keeps working (see scripts/lib/env-compat.mjs).
 * next.config.ts already runs the same shim at build time; this covers the
 * runtime process spawned by `next start` / `next dev`.
 */
import { normalizeWebuiEnv } from "../../scripts/lib/env-compat.mjs";

export async function register() {
  normalizeWebuiEnv();
}
