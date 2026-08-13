"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/lib/client";
import type { ProviderModelsDto } from "@/lib/extensions";
import {
  formatModelLabel,
  filterEnabledModelOptions,
  modelOrderPreferenceFromProviders,
  sortModelOptions,
  type ModelOption,
} from "@/lib/model-options";
import {
  getIntelligenceVariants,
  type IntelligenceVariant,
} from "@/lib/model-variants";

/** Empty value for "モデル未設定" in the agent model dropdown. */
export const MODEL_UNSET_VALUE = "";

/**
 * Agent model dropdown option for a model that exists in the agent's
 * frontmatter but not in the provider catalogue (disabled provider, removed
 * model, or the catalogue fetch failed). Keeps the current selection visible
 * so the dropdown never silently reads as unset.
 */
function missingModelOption(value: string): ModelOption {
  return {
    value,
    label: value.split("::").join(" / "),
    group: "現在のモデル",
  };
}

/**
 * Return `options` with `currentValue` guaranteed present. Used by the agent
 * settings screens so a model pinned in frontmatter stays selectable even
 * when it is disabled or absent from the provider catalogue.
 */
export function ensureModelOption(
  options: ModelOption[],
  currentValue: string,
): ModelOption[] {
  if (!currentValue || options.some((option) => option.value === currentValue)) {
    return options;
  }
  return [...options, missingModelOption(currentValue)];
}

export type ProviderModelCatalogue = {
  /** `providerID::modelID` → variants the model declares (may be empty). */
  variantsMap: Record<string, IntelligenceVariant[]>;
  /** Sorted selectable models (`デフォルト` first), for the agent settings. */
  modelOptions: ModelOption[];
};

/**
 * Provider catalogue for the agent settings screens: per-model intelligence
 * variants and selectable model options.
 *
 * Both derive from `/api/extensions/provider-models`. Failures (server down,
 * test environments without the endpoint) yield an empty catalogue — callers
 * fall back to {@link ALL_INTELLIGENCE_VARIANTS} and to the current model's
 * own entry via {@link ensureModelOption}.
 */
export function useProviderModels(): ProviderModelCatalogue {
  const [catalogue, setCatalogue] = useState<ProviderModelCatalogue>({
    variantsMap: {},
    modelOptions: [{ value: MODEL_UNSET_VALUE, label: "デフォルト", group: "デフォルト" }],
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await getJson<{ providers?: ProviderModelsDto[] }>(
          "/api/extensions/provider-models",
        );
        if (cancelled || !Array.isArray(data?.providers)) return;
        const variantsMap: Record<string, IntelligenceVariant[]> = {};
        const options: ModelOption[] = [];
        for (const provider of data.providers) {
          for (const model of provider.models ?? []) {
            const key = `${provider.id}::${model.id}`;
            const variants = getIntelligenceVariants(model);
            if (variants.length > 0) variantsMap[key] = variants;
            options.push({
              value: key,
              label: formatModelLabel(model.name, model.id),
              group: provider.name || provider.id,
              image:
                model.capabilities?.input?.image === true ||
                model.capabilities?.attachment === true,
            });
          }
        }
        const enabled = filterEnabledModelOptions(options, data.providers);
        setCatalogue({
          variantsMap,
          modelOptions: [
            { value: MODEL_UNSET_VALUE, label: "デフォルト", group: "デフォルト" },
            ...sortModelOptions(
              enabled,
              modelOrderPreferenceFromProviders(data.providers),
            ),
          ],
        });
      } catch {
        // 取得失敗時は空のまま（デフォルトのみ）。呼び出し側がフォールバックする。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return catalogue;
}
