/**
 * Single switch point for the OpenCode API generation the client uses.
 *
 * The engine currently exposes two generations side by side:
 *
 * - **v1** — the original flat surface (`/session`, `/session/{id}/message`,
 *   `/permission`, ...).
 * - **v2 (beta)** — the `/api/*` surface (`/api/session/{id}/prompt`,
 *   `/api/session/{id}/interrupt`, ...).
 *
 * Migration plan (Phase D, see `docs/specs/opencode-api-v2-migration.md`):
 * v2-migration-target operations (session CRUD, prompt, interrupt, compact,
 * permission, question, revert, SSE) resolve to their `...PathV2` builders
 * when this flag is `"v2"`; v1-maintain operations (todo, diff, command,
 * children, ...) keep their v1 builders regardless.
 *
 * This is the **only** place that decides the generation. Flipping the
 * constant to `"v2"` migrates the whole client in one step; no caller ever
 * mixes generations for the same operation.
 */

export type OpenCodeApiGeneration = "v1" | "v2";

/** The API generation every v2-migration-target client call resolves to. */
export const OPENCODE_API_GENERATION: OpenCodeApiGeneration = "v1";

/** True when the client uses v2 paths for migration-target operations. */
export function isV2ApiGeneration(): boolean {
  return OPENCODE_API_GENERATION === "v2";
}
