import { describe, expect, it } from "vitest";
import {
  lookupModelPricing,
  setModelPricingRegistry,
} from "./model-pricing-registry";

describe("model-pricing-registry", () => {
  it("replaces the whole registry from a provider listing", () => {
    setModelPricingRegistry([
      {
        id: "provider-a",
        models: [{ id: "model-1", pricing: { input: 1, output: 2 } }],
      },
      {
        id: "provider-b",
        models: [
          { id: "model-2", pricing: { input: 3, output: 4 } },
          { id: "model-3", pricing: null },
          { id: "model-4" },
        ],
      },
    ]);
    expect(lookupModelPricing("provider-a", "model-1")).toEqual({
      input: 1,
      output: 2,
    });
    expect(lookupModelPricing("provider-b", "model-2")).toEqual({
      input: 3,
      output: 4,
    });
    expect(lookupModelPricing("provider-b", "model-3")).toBeNull();
    expect(lookupModelPricing("provider-b", "model-4")).toBeNull();
    expect(lookupModelPricing("unknown", "model-1")).toBeNull();
  });

  it("clears the registry on replace", () => {
    setModelPricingRegistry([
      { id: "provider-a", models: [{ id: "model-1", pricing: { input: 1, output: 2 } }] },
    ]);
    expect(lookupModelPricing("provider-a", "model-1")).not.toBeNull();
    setModelPricingRegistry([{ id: "provider-b", models: [] }]);
    expect(lookupModelPricing("provider-a", "model-1")).toBeNull();
    expect(lookupModelPricing("provider-b", "unknown")).toBeNull();
  });

  it("handles null/undefined inputs and models without pricing", () => {
    setModelPricingRegistry(null);
    expect(lookupModelPricing(undefined, "model-1")).toBeNull();
    expect(lookupModelPricing("provider-a", undefined)).toBeNull();
    expect(lookupModelPricing("provider-a", "model-1")).toBeNull();
    setModelPricingRegistry(undefined);
    expect(lookupModelPricing("provider-a", "model-1")).toBeNull();
  });
});
