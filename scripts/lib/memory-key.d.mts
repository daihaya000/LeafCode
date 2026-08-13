export type MemoryPolarity = "affirmative" | "negative";

export type MemorySimilarityVerdict = {
  /** True when `candidate` should be merged into `existing` instead of inserted. */
  duplicate: boolean;
  similarity: number;
  threshold: number;
  reason:
    | "norm-key"
    | "same-identifiers"
    | "different-identifiers"
    | "no-identifiers"
    | "opposite-polarity";
};

export const MEMORY_SIMILARITY_SAME_IDENTIFIERS: number;
export const MEMORY_SIMILARITY_DIFFERENT_IDENTIFIERS: number;
export const MEMORY_SIMILARITY_NO_IDENTIFIERS: number;
export const MEMORY_IDENTIFIER_OVERLAP: number;
export const MEMORY_TRIGRAM_SIZE: number;

export function memoryPolarity(content: string): MemoryPolarity;

export function normalizeMemoryKey(content: string): string;

export function memoryIdentifiers(content: string): Set<string>;

export function memoryTrigrams(normalized: string): Set<string>;

export function jaccard(a: Set<string>, b: Set<string>): number;

export function trigramSimilarity(a: string, b: string): number;

export function lengthCompatible(a: string, b: string): boolean;

export function memorySimilarityVerdict(
  existing: string,
  candidate: string,
): MemorySimilarityVerdict;
