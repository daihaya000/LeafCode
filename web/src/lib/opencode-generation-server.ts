/**
 * Server-side OpenCode API generation resolution.
 *
 * The server has no `window`/localStorage, so `opencode-generation.ts` falls
 * back to a resolver registered at boot. This module provides that resolver:
 * it reads the durable `settings` table (the same key the Settings → Engine
 * tab writes via `/api/settings/opencode-api-generation`) so server-side code
 * (goal-loop, hang-watchdog, memory-extract, ...) follows the client's choice
 * and v1/v2 never mix for one session.
 *
 * Deliberately separate from `opencode-generation.ts` so SQLite code stays
 * out of the browser bundle: this module is only imported by
 * `instrumentation.ts` (server boot) and server-only code.
 */

import { getSetting } from "./db";
import {
  DEFAULT_OPENCODE_API_GENERATION,
  isOpenCodeApiGeneration,
  OPENCODE_API_GENERATION_SETTING_KEY,
  type OpenCodeApiGeneration,
} from "./opencode-generation";

/** Read the generation from the durable settings table. */
export function readServerOpenCodeApiGeneration(): OpenCodeApiGeneration {
  try {
    const raw = getSetting(OPENCODE_API_GENERATION_SETTING_KEY);
    return isOpenCodeApiGeneration(raw)
      ? raw
      : DEFAULT_OPENCODE_API_GENERATION;
  } catch {
    return DEFAULT_OPENCODE_API_GENERATION;
  }
}
