/**
 * Intelligence variant domain shared by the home and task detail composers.
 *
 * The OpenCode provider API exposes per-model `variants` metadata. We only
 * surface the `high` and `low` intelligence variants in the UI; any other
 * declared variant keys are ignored. Variants with `disabled: true` are
 * excluded from the available options.
 */

export type IntelligenceVariant = "high" | "low";

/**
 * Metadata for a single model from the provider API, used to extract
 * intelligence variant declarations.
 */
export type ModelVariantMeta = {
  variants?: Record<string, { disabled?: boolean } | undefined>;
};

/**
 * Common model metadata shape used in Home/Task provider state maps.
 */
export type ProviderModelMeta = {
  name?: string;
  variants?: Record<string, { disabled?: boolean } | undefined>;
};

const INTELLIGENCE_KEYS: readonly IntelligenceVariant[] = ["high", "low"];

/**
 * Returns the subset of IntelligenceVariant values that the given model
 * declares and does not disable. Variants with `disabled: true` are excluded.
 * The result is always in fixed order ["high", "low"], independent of input
 * key order.
 */
export function getIntelligenceVariants(
  model: ModelVariantMeta | undefined,
): IntelligenceVariant[] {
  if (!model?.variants) return [];
  const result: IntelligenceVariant[] = [];
  for (const key of INTELLIGENCE_KEYS) {
    const entry = model.variants[key];
    if (entry === undefined) continue;
    if (!Object.prototype.hasOwnProperty.call(model.variants, key)) continue;
    if (entry?.disabled === true) continue;
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
  return value === "high" || value === "low";
}