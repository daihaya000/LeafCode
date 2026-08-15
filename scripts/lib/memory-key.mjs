/**
 * Normalization and near-duplicate detection for memory content, shared by
 * the web UI (`web/src/lib/memory-key.ts`), the MCP server
 * (`browser-bridge/shared/memory-schema.mjs`) and scripts (REFACTORING_PLAN
 * P1-d / IMPROVEMENT 5-1). Both sides write `memories.norm_key` and must
 * agree on what counts as the same proposition, otherwise the MCP server
 * reintroduces the paraphrase duplicates the web side filters out.
 *
 * No `./db` import here so the MCP server and browser bundles can reuse it.
 */

/** Characters removed before comparison: whitespace, punctuation, symbols. */
const IGNORED_CHARS_RE = /[\s\p{P}\p{S}]+/gu;

/**
 * Japanese *affirmative* sentence tails that carry no propositional meaning.
 * Extraction runs paraphrase one fact as 「〜する」「〜します」「〜している」, so the
 * canonical key drops the tail before comparison.
 */
const JP_TAIL_RE =
  /(?:しています|しました|されています|されている|されました|しておく|している|すべきである|することがある|する必要がある|すること|されます|される|すべき|します|したまま|した|する|であり|であるため|である|ます|です|だった|になっている|になる)$/u;

/**
 * Negative tails. These must NEVER be stripped like affirmative ones:
 * 「コミットしない」and「コミットする」are opposite instructions, and collapsing
 * them would silently replace a rule with its negation.
 */
const JP_NEGATIVE_TAIL_RE =
  /(?:してはいけない|してはならない|すべきではない|しないこと|されていない|されません|されない|しません|しないでください|しないで下さい|ではない|しない|ません|ない)$/u;

/** Marker appended to a normalized negative proposition. */
const NEGATIVE_MARKER = "nai";

export const MEMORY_SIMILARITY_SAME_IDENTIFIERS = 0.6;
export const MEMORY_SIMILARITY_DIFFERENT_IDENTIFIERS = 0.85;
export const MEMORY_SIMILARITY_NO_IDENTIFIERS = 0.75;
export const MEMORY_IDENTIFIER_OVERLAP = 0.6;
export const MEMORY_TRIGRAM_SIZE = 3;

/**
 * Polarity of a proposition, derived from its (normalized) tail. Compared
 * separately from similarity so opposite rules are never merged.
 */
export function memoryPolarity(content) {
  if (typeof content !== "string") return "affirmative";
  const text = content.normalize("NFKC").toLowerCase().replace(IGNORED_CHARS_RE, "");
  return JP_NEGATIVE_TAIL_RE.test(text) ? "negative" : "affirmative";
}

/**
 * Canonical comparison key. The same proposition written with different
 * spacing, width, case, punctuation or polite form collapses to one key, while
 * negation is preserved as an explicit marker.
 * Returns "" only for content that is entirely ignorable.
 */
export function normalizeMemoryKey(content) {
  if (typeof content !== "string") return "";
  const text = content.normalize("NFKC").toLowerCase().replace(IGNORED_CHARS_RE, "");
  const negative = JP_NEGATIVE_TAIL_RE.exec(text);
  if (negative) {
    return `${text.slice(0, negative.index)}${NEGATIVE_MARKER}`;
  }
  // Strip one trailing verb/polite form; repeated stripping would eat real words.
  return text.replace(JP_TAIL_RE, "");
}

/**
 * ASCII identifier tokens (file names, commands, config keys, flags). These are
 * the load-bearing part of a technical proposition: `MEMORY.md`, `.gitignore`,
 * `npm run test:encoding`. Pure numbers are dropped as noise.
 */
export function memoryIdentifiers(content) {
  const out = new Set();
  if (typeof content !== "string") return out;
  const normalized = content.normalize("NFKC").toLowerCase();
  const matches = normalized.match(/[a-z0-9][a-z0-9._/:-]{1,}/g) ?? [];
  for (const raw of matches) {
    const token = raw.replace(/^[._/:-]+|[._/:-]+$/g, "");
    if (token.length < 2) continue;
    if (/^[0-9.]+$/.test(token)) continue;
    out.add(token);
  }
  return out;
}

/** Character n-grams of the normalized text (short strings map to themselves). */
export function memoryTrigrams(normalized) {
  const grams = new Set();
  if (normalized.length === 0) return grams;
  if (normalized.length <= MEMORY_TRIGRAM_SIZE) {
    grams.add(normalized);
    return grams;
  }
  for (let i = 0; i + MEMORY_TRIGRAM_SIZE <= normalized.length; i += 1) {
    grams.add(normalized.slice(i, i + MEMORY_TRIGRAM_SIZE));
  }
  return grams;
}

/** Jaccard index of two sets (0..1). */
export function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return a.size === b.size ? 1 : 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const gram of small) {
    if (large.has(gram)) shared += 1;
  }
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Similarity of two raw contents (0..1). Normalization is applied first, so
 * punctuation/politeness differences do not lower the score.
 */
export function trigramSimilarity(a, b) {
  const normA = normalizeMemoryKey(a);
  const normB = normalizeMemoryKey(b);
  if (normA.length === 0 || normB.length === 0) return normA === normB ? 1 : 0;
  if (normA === normB) return 1;
  return jaccard(memoryTrigrams(normA), memoryTrigrams(normB));
}

/**
 * Cheap prefilter so similarity is only computed for plausible candidates.
 * Lengths differing by more than ~2x cannot be the same proposition.
 */
export function lengthCompatible(a, b) {
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return la === lb;
  const ratio = la > lb ? la / lb : lb / la;
  return ratio <= 2;
}

/**
 * Decide whether two contents state the same thing.
 *
 * Guards, in order:
 * 1. Opposite polarity is never a duplicate ("コミットしない" vs "コミットする").
 * 2. Equal canonical keys are duplicates outright.
 * 3. Otherwise the identifier overlap picks the prose threshold, so shared
 *    boilerplate about *different* files does not collapse into one row.
 */
export function memorySimilarityVerdict(existing, candidate) {
  if (memoryPolarity(existing) !== memoryPolarity(candidate)) {
    return { duplicate: false, similarity: 0, threshold: 1, reason: "opposite-polarity" };
  }
  const normExisting = normalizeMemoryKey(existing);
  const normCandidate = normalizeMemoryKey(candidate);
  if (normExisting.length > 0 && normExisting === normCandidate) {
    return { duplicate: true, similarity: 1, threshold: 0, reason: "norm-key" };
  }
  const idsExisting = memoryIdentifiers(existing);
  const idsCandidate = memoryIdentifiers(candidate);
  const bothEmpty = idsExisting.size === 0 && idsCandidate.size === 0;
  const sameSubject =
    !bothEmpty && jaccard(idsExisting, idsCandidate) >= MEMORY_IDENTIFIER_OVERLAP;
  const threshold = bothEmpty
    ? MEMORY_SIMILARITY_NO_IDENTIFIERS
    : sameSubject
      ? MEMORY_SIMILARITY_SAME_IDENTIFIERS
      : MEMORY_SIMILARITY_DIFFERENT_IDENTIFIERS;
  const reason = bothEmpty
    ? "no-identifiers"
    : sameSubject
      ? "same-identifiers"
      : "different-identifiers";
  if (!lengthCompatible(normExisting, normCandidate)) {
    return { duplicate: false, similarity: 0, threshold, reason };
  }
  const similarity = jaccard(
    memoryTrigrams(normExisting),
    memoryTrigrams(normCandidate),
  );
  return { duplicate: similarity >= threshold, similarity, threshold, reason };
}
