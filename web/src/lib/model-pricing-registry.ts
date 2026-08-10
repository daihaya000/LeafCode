/**
 * Client-side registry of manual per-model token pricing, loaded from the
 * `/api/extensions/provider-models` listing. Used to estimate usage cost for
 * models whose cost OpenCode does not report (see `openai-pricing.ts`).
 *
 * The registry is a plain module-level map populated by the settings screen
 * and the task/home views when they fetch the provider list. Lookups are
 * synchronous so cost estimation never blocks rendering.
 */

import type { TokenPrice } from "./openai-pricing";

const pricingByKey = new Map<string, TokenPrice>();

/** Replace the whole registry with the pricing from a provider listing. */
export function setModelPricingRegistry(
  providers: {
    id: string;
    models?: { id: string; pricing?: TokenPrice | null }[];
  }[] | undefined | null,
): void {
  pricingByKey.clear();
  for (const provider of providers ?? []) {
    for (const model of provider.models ?? []) {
      if (model.pricing) pricingByKey.set(`${provider.id}::${model.id}`, model.pricing);
    }
  }
}

/** Look up manual pricing for a `providerID::modelID` key, if configured. */
export function lookupModelPricing(
  providerID: string | undefined,
  modelID: string | undefined,
): TokenPrice | null {
  if (!providerID || !modelID) return null;
  return pricingByKey.get(`${providerID}::${modelID}`) ?? null;
}
