/**
 * Intelligence variant domain shared by the home and task detail composers.
 *
 * The OpenCode provider API exposes per-model `variants` metadata. We surface
 * the known intelligence / reasoning-effort keys that a model declares and
 * does not disable. The available options therefore change with the selected
 * model (e.g. GPT-5.6 Sol → none/low/medium/high/xhigh).
 */

export type IntelligenceVariant =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "thinking";

/**
 * Metadata for a single model from the provider API, used to extract
 * intelligence variant declarations.
 */
export type ModelVariantMeta = {
  name?: string;
  variants?: Record<string, { disabled?: boolean } | undefined>;
};

/**
 * Common model metadata shape used in Home/Task provider state maps.
 */
export type ProviderModelMeta = {
  name?: string;
  variants?: Record<string, { disabled?: boolean } | undefined>;
  /** Context/output token limits reported by the provider API, if known. */
  limit?: { context: number; output?: number; input?: number };
};

/** Preferred display / sort order from least to most effort. */
const INTELLIGENCE_KEYS: readonly IntelligenceVariant[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "thinking",
];

const INTELLIGENCE_KEY_SET = new Set<string>(INTELLIGENCE_KEYS);

/**
 * Returns the subset of IntelligenceVariant values that the given model
 * declares and does not disable. Variants with `disabled: true` are excluded.
 * The result follows {@link INTELLIGENCE_KEYS} order, independent of input
 * key order. Unknown variant keys are ignored.
 */
export function getIntelligenceVariants(
  model: ModelVariantMeta | undefined,
): IntelligenceVariant[] {
  if (!model?.variants) return [];
  const result: IntelligenceVariant[] = [];
  for (const key of INTELLIGENCE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(model.variants, key)) continue;
    // A declared key with an undefined/`{}` value is enabled. Skipping
    // `undefined` here used to hide effort options after cache/API
    // round-trips that keep the key but drop the empty object.
    if (model.variants[key]?.disabled === true) continue;
    result.push(key);
  }
  return result;
}

/**
 * Type guard for a valid intelligence variant value. Used by the API route
 * to validate client-supplied `variant` strings before forwarding them to
 * OpenCode.
 */
export function isIntelligenceVariant(
  value: unknown,
): value is IntelligenceVariant {
  return typeof value === "string" && INTELLIGENCE_KEY_SET.has(value);
}
