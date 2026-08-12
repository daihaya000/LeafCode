/**
 * Shared wait budgets for image pre-analysis (VL) and first-turn sends.
 *
 * Settings allow a VL turn up to {@link VISION_ANALYSIS_TIMEOUT_MAX_MS}. Every
 * outer timeout (browser → BFF → new-task `ocServer` → route `maxDuration`)
 * must cover that plus setup, or a legitimate image send is aborted while the
 * analysis model is still working.
 */

/** Matches the image-analysis settings UI minimum. */
export const VISION_ANALYSIS_TIMEOUT_MIN_MS = 10_000;

/** Default VL pre-analysis timeout (`QWEN_NATIVE_DEFAULTS.timeoutMs`). */
export const VISION_ANALYSIS_TIMEOUT_DEFAULT_MS = 120_000;

/** Matches the image-analysis settings UI maximum. */
export const VISION_ANALYSIS_TIMEOUT_MAX_MS = 600_000;

/**
 * Workspace / session create + `prompt_async` 202 after VL finishes.
 * Not the agent turn itself — that is watched by the hang watchdog.
 */
export const IMAGE_SEND_SETUP_SLACK_MS = 30_000;

/**
 * Engine accept wait for `prompt_async` 202. Matches BFF `UPSTREAM_TIMEOUT_MS`
 * in `app/api/opencode/[...path]/route.ts`. `ocServer`'s implicit 10s default
 * is far too short under load.
 */
export const SESSION_PROMPT_ASYNC_TIMEOUT_MS = 90_000;

/**
 * Client wait for a new Home task without attachments: isolation provision
 * (worktree / devcontainer) + session + first `prompt_async` or slash-command.
 * Kept just under the historical 300s route `maxDuration`, matching
 * `SESSION_COMMAND_TIMEOUT_MS` in `useSessionStream.ts`.
 */
export const NEW_TASK_SEND_TIMEOUT_MS = 295_000;

/**
 * Client / BFF outer wait when a send may run VL pre-analysis. Must exceed
 * the settings max or a 600s analysis is killed at 180s.
 */
export const IMAGE_ANALYSIS_SEND_TIMEOUT_MS =
  VISION_ANALYSIS_TIMEOUT_MAX_MS + IMAGE_SEND_SETUP_SLACK_MS;

/** Next.js `maxDuration` (seconds) so VL + setup is not killed mid-analysis. */
export const IMAGE_SEND_ROUTE_MAX_DURATION_SEC =
  Math.ceil(IMAGE_ANALYSIS_SEND_TIMEOUT_MS / 1000) + 10;

export function clampVisionAnalysisTimeoutMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return VISION_ANALYSIS_TIMEOUT_DEFAULT_MS;
  }
  return Math.min(
    VISION_ANALYSIS_TIMEOUT_MAX_MS,
    Math.max(VISION_ANALYSIS_TIMEOUT_MIN_MS, Math.round(value)),
  );
}
