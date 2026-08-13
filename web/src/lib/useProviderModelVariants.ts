"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/lib/client";
import type { ProviderModelsDto } from "@/lib/extensions";
import {
  getIntelligenceVariants,
  type IntelligenceVariant,
} from "@/lib/model-variants";

/**
 * Per-model intelligence variant catalogue for the agent settings screens.
 *
 * Maps `providerID::modelID` to the variants the model declares; callers fall
 * back to {@link ALL_INTELLIGENCE_VARIANTS} for models absent from the
 * provider response. Failures (server down, test environments without the
 * endpoint) yield an empty map.
 */
export function useProviderModelVariants(): Record<
  string,
  IntelligenceVariant[]
> {
  const [map, setMap] = useState<Record<string, IntelligenceVariant[]>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await getJson<{ providers?: ProviderModelsDto[] }>(
          "/api/extensions/provider-models",
        );
        if (cancelled || !Array.isArray(data?.providers)) return;
        const next: Record<string, IntelligenceVariant[]> = {};
        for (const provider of data.providers) {
          for (const model of provider.models ?? []) {
            const variants = getIntelligenceVariants(model);
            if (variants.length > 0) {
              next[`${provider.id}::${model.id}`] = variants;
            }
          }
        }
        setMap(next);
      } catch {
        // 取得失敗時は空のまま、呼び出し側が全 variants でフォールバックする。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return map;
}
