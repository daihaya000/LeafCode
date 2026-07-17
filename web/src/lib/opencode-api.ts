import type { components, operations, paths } from "./opencode-schema";

/**
 * Ergonomic aliases over the auto-generated OpenCode OpenAPI schema
 * (`opencode-schema.d.ts`, regenerate with `npm run gen:types`).
 *
 * Prefer these when adding new engine calls so request/response shapes stay in
 * sync with the OpenCode spec. Existing hand-written types in `types.ts` are
 * being migrated incrementally.
 */
export type OcSchemas = components["schemas"];

/** A single named OpenCode schema, e.g. `OcSchema<"Session">`. */
export type OcSchema<K extends keyof OcSchemas> = OcSchemas[K];

export type OcPaths = paths;
export type OcOperations = operations;
