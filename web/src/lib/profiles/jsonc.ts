/**
 * JSONC parsing helpers.
 *
 * Delegated to the shared `scripts/lib/jsonc.mjs` implementation so the web
 * UI and CLI sync scripts cannot drift (6-1 / REFACTORING_PLAN P1-b).
 */
export {
  readJsonc,
  stripJsonc,
  writeJsonc,
} from "../../../../scripts/lib/jsonc.mjs";
