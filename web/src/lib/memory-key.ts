/**
 * Normalization and near-duplicate detection for memory content
 * (docs/specs/memory-layer.md 「重複排除」).
 *
 * Delegated to the shared `scripts/lib/memory-key.mjs` implementation so the
 * web API, MCP server and CLI cannot drift (5-1 / REFACTORING_PLAN P1-d).
 * Types are re-exported for consumers (`db.ts`, `memory.ts`).
 *
 * No `./db` import here so the MCP server and browser bundles can reuse it.
 */
export {
  jaccard,
  lengthCompatible,
  memoryIdentifiers,
  memoryPolarity,
  memorySimilarityVerdict,
  memoryTrigrams,
  normalizeMemoryKey,
  trigramSimilarity,
  MEMORY_IDENTIFIER_OVERLAP,
  MEMORY_SIMILARITY_DIFFERENT_IDENTIFIERS,
  MEMORY_SIMILARITY_NO_IDENTIFIERS,
  MEMORY_SIMILARITY_SAME_IDENTIFIERS,
  MEMORY_TRIGRAM_SIZE,
  type MemoryPolarity,
  type MemorySimilarityVerdict,
} from "../../../scripts/lib/memory-key.mjs";
